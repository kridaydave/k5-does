#!/usr/bin/env node
// self-os classification engine. One pass over the unclassified queue, then exit.
// Started once at boot by scripts/selfos-engine.service (systemd user unit), so a
// failure here is loud: a boot process that quietly does nothing is worse than one
// that exits non-zero and shows up red in `systemctl --user status`.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = process.env.SELFOS_API ?? 'http://127.0.0.1:3000'

// Default is a free opencode model. `opencode models` on this box lists
// opencode/cat-jam-free, opencode/space-bunny-free and friends; grok-code-fast-1
// is NOT among them, so it is not the default here.
const MODEL = process.env.SELFOS_MODEL ?? 'opencode/cat-jam-free'

// Dry run classifies with a local heuristic and never shells out to opencode, so
// the full pull -> classify -> write-back loop is testable with zero AI calls.
const DRY_RUN = process.env.SELFOS_DRY_RUN === '1'

// One hung model call must not stall the boot pass; the rest of the queue still
// gets written, and the stalled item simply stays unclassified for the next run.
const PER_ITEM_TIMEOUT_MS = 120_000
const TITLE_MAX = 80

/** @typedef {'task' | 'doc' | 'note' | 'unknown'} Kind */
/** @typedef {{ id: string, raw_text: string, created_at: string }} QueueItem */
/** @typedef {{ kind: Kind, title: string | null, body: string | null }} Classification */
/** @typedef {{ id: string, kind: Kind, title: string | null, body: string | null }} Result */

/** @type {ReadonlySet<string>} */
const KINDS = new Set(['task', 'doc', 'note', 'unknown'])

function log(message) {
  console.log(`[engine] ${new Date().toISOString()} ${message}`)
}

/**
 * Node wraps connection problems as a bare `TypeError: fetch failed` and hides
 * the real reason on `cause`, which is the part worth reading in a journal.
 *
 * @param {unknown} e
 * @returns {string}
 */
function describeError(e) {
  if (!(e instanceof Error)) return String(e)

  const cause = /** @type {{ cause?: unknown }} */ (e).cause
  if (cause instanceof Error && cause.message !== '') return `${e.message}: ${cause.message}`
  return e.message
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function textOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Pull the queue. Returns null when the site is unreachable or unhappy, which the
 * caller turns into a non-zero exit.
 *
 * @returns {Promise<unknown | null>}
 */
async function fetchQueue() {
  let response
  try {
    response = await fetch(`${API}/api/queue`)
  } catch (e) {
    log(`queue fetch failed: ${describeError(e)}`)
    return null
  }
  if (!response.ok) {
    log(`queue fetch failed: HTTP ${response.status}`)
    return null
  }
  return response.json()
}

/**
 * The queue is network data, so shape it here rather than trusting it downstream.
 * Rows that are not `{ id: string, raw_text: string }` are unclassifiable by
 * definition, so they are counted as failures instead of being classified.
 *
 * @param {unknown} payload
 * @returns {{ items: QueueItem[], malformed: number } | null}
 */
function parseQueue(payload) {
  if (!Array.isArray(payload)) return null

  /** @type {QueueItem[]} */
  const items = []
  let malformed = 0

  for (const row of payload) {
    if (
      typeof row === 'object' &&
      row !== null &&
      typeof (/** @type {QueueItem} */ (row).id) === 'string' &&
      typeof (/** @type {QueueItem} */ (row).raw_text) === 'string'
    ) {
      const item = /** @type {QueueItem} */ (row)
      items.push({ id: item.id, raw_text: item.raw_text, created_at: item.created_at })
    } else {
      malformed++
    }
  }

  return { items, malformed }
}

/**
 * `opencode run --format json` emits NDJSON, one event per line, with the model's
 * prose in `{ type: 'text', part: { text } }`. Collect the text parts in order.
 *
 * @param {string} stdout
 * @returns {string}
 */
function collectModelText(stdout) {
  /** @type {string[]} */
  const parts = []

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (
      typeof event === 'object' &&
      event !== null &&
      typeof (/** @type {{ part?: unknown }} */ (event).part) === 'object' &&
      (/** @type {{ part: { type?: unknown } }} */ (event).part).type === 'text'
    ) {
      const text = (/** @type {{ part: { text?: unknown } }} */ (event).part).text
      if (typeof text === 'string') parts.push(text)
    }
  }

  return parts.join('')
}

/**
 * Models wrap JSON in fences or pad it with a sentence despite being told not to.
 * Try the whole string, then the outermost braces.
 *
 * @param {string} text
 * @returns {unknown}
 */
function extractJsonObject(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to brace slicing
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Never trust model output shape. A missing or bogus `kind` degrades to 'unknown'
 * (a value the app already knows how to render); a non-object is a real failure.
 *
 * @param {unknown} value
 * @returns {Classification | null}
 */
function coerceClassification(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = /** @type {Record<string, unknown>} */ (value)
  const kind = typeof record.kind === 'string' && KINDS.has(record.kind) ? record.kind : 'unknown'
  const title = textOrNull(record.title)

  return {
    kind: /** @type {Kind} */ (kind),
    title: title === null ? null : title.slice(0, TITLE_MAX),
    body: textOrNull(record.body),
  }
}

/**
 * The caller writes this into a 0600 temp file and passes `--file`, so the raw
 * text never lands in `argv` where anything on the box running `ps` could read
 * it. These are private notes, so that stays the arrangement.
 *
 * @param {string} rawText
 * @returns {string}
 */
function promptFor(rawText) {
  return [
    'Classify this captured note. Reply with ONE JSON object and nothing else.',
    'No prose, no markdown, no code fences.',
    `Schema: {"kind":"task"|"doc"|"note"|"unknown","title":string|null,"body":string|null}`,
    'kind: task = something to do, doc = reference material or a link, note = a thought, unknown = none of those.',
    `title: short label, at most ${TITLE_MAX} chars, null if a title would be meaningless.`,
    'body: the text cleaned up or lightly elaborated, null if the title already says it all.',
    '',
    'Captured text:',
    rawText,
  ].join('\n')
}

/**
 * One `opencode run` per item. Resolves to null on any failure (spawn error,
 * timeout, non-zero exit, unparseable output) so the caller records a failure and
 * moves on rather than losing the rest of the queue.
 *
 * @param {string} rawText
 * @returns {Promise<Classification | null>}
 */
function classifyWithOpenCode(rawText) {
  return new Promise((resolve) => {
    // Keep the private note out of argv/`ps` by passing it through a 0600 temp file.
    const dir = mkdtempSync(join(tmpdir(), 'selfos-'))
    const promptPath = join(dir, 'prompt.txt')
    writeFileSync(promptPath, promptFor(rawText), { mode: 0o600, encoding: 'utf8' })

    const child = spawn(
      'opencode',
      [
        'run',
        '--model',
        MODEL,
        '--format',
        'json',
        '--file',
        promptPath,
        '--auto',
        'classify this capture',
      ],
      // Own process group so a timeout can take down opencode's own children too;
      // killing just the direct child leaves them running and they pile up one
      // leaked tree per hung item at every boot.
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    )

    let stdout = ''
    let settled = false

    const finish = (/** @type {Classification | null} */ value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // temp dir may already be gone; nothing to do
      }
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      finish(null)
    }, PER_ITEM_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (/** @type {string} */ chunk) => {
      stdout += chunk
    })
    child.stderr.resume()

    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code !== 0) {
        finish(null)
        return
      }
      finish(coerceClassification(extractJsonObject(collectModelText(stdout))))
    })
  })
}

const TASK_LEAD =
  /^(todo|need to|must|should|remind me|don't forget|remember to|fix|buy|call|email|send|finish|start|stop|check|update|write|draft|ask|review|ship|deploy|clean|book|order)\b/i
const TASK_ANY = /\b(todo|to-do|needs? to|must|should|remind me|don't forget)\b/i
const DOC_HINT = /(https?:\/\/|www\.)/i

/**
 * Test aid, not a product feature. Deliberately crude so it cannot drift into
 * being the real classifier.
 *
 * @param {string} rawText
 * @returns {Classification}
 */
function dryRunClassify(rawText) {
  const text = rawText.replace(/\s+/g, ' ').trim()
  const kind = TASK_LEAD.test(text) || TASK_ANY.test(text) ? 'task' : DOC_HINT.test(text) ? 'doc' : 'note'
  const title = text.slice(0, TITLE_MAX)

  return {
    kind: /** @type {Kind} */ (kind),
    title: title === '' ? null : title,
    body: text === '' ? null : text,
  }
}

/**
 * @param {QueueItem} item
 * @returns {Promise<Result | null>}
 */
async function classifyItem(item) {
  try {
    const classification = DRY_RUN ? dryRunClassify(item.raw_text) : await classifyWithOpenCode(item.raw_text)
    if (classification === null) return null
    return { id: item.id, ...classification }
  } catch (e) {
    // mkdtempSync and spawn throw synchronously inside the Promise executor, so a
    // full /tmp or an exhausted process table rejects here. One item's failure
    // must not take the rest of the queue down with it.
    log(`item ${item.id} failed: ${describeError(e)}`)
    return null
  }
}

async function main() {
  const startedAt = new Date().toISOString()

  const payload = await fetchQueue()
  if (payload === null) {
    log('aborting: no queue to work with')
    return 1
  }

  const parsed = parseQueue(payload)
  if (parsed === null) {
    log('queue fetch failed: response was not a JSON array')
    return 1
  }
  const { items, malformed } = parsed
  let failureCount = malformed

  if (items.length === 0) {
    // Rows that arrived but were unusable are a broken contract, not an empty
    // queue. Reporting success here would hide it forever.
    if (malformed > 0) {
      log(`aborting: ${malformed} rows were not in queue shape, none classifiable`)
      return 1
    }
    log('queue empty')
    return 0
  }

  log(`pulled ${items.length} items${DRY_RUN ? ' (dry run)' : ''}${malformed > 0 ? `, ${malformed} malformed` : ''}`)

  // A malformed row means the queue endpoint broke its contract. Classify what
  // did arrive, but the run cannot claim success: the dropped rows are gone for
  // this pass and nothing downstream will ever hear about them.
  if (malformed > 0) {
    log(`queue came back malformed: ${malformed} row(s) were not in queue shape and are dropped this run`)
  }

  /** @type {Result[]} */
  const results = []

  for (const item of items) {
    const result = await classifyItem(item)
    if (result === null) {
      failureCount++
      log(`item ${item.id} failed to classify`)
      continue
    }
    results.push(result)
    log(`item ${item.id} -> ${result.kind}`)
  }

  if (results.length === 0) {
    log(`aborting: every item failed (${failureCount} failures), nothing to write back`)
    return 1
  }

  let response
  try {
    response = await fetch(`${API}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        failure_count: failureCount,
        results,
      }),
    })
  } catch (e) {
    log(`classify write-back failed: ${describeError(e)}`)
    return 1
  }

  if (!response.ok) {
    log(`classify write-back failed: HTTP ${response.status}`)
    return 1
  }

  const summary = await response.json()
  log(`wrote back ${results.length} results, failures ${failureCount}`)
  log(`server said updated ${summary.updated}, skipped ${summary.skipped}`)

  // The write-back landed, but the queue itself was malformed. Exit non-zero so
  // the boot run shows red rather than reporting a clean pass over dropped rows.
  return malformed > 0 ? 1 : 0
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((e) => {
    log(`unexpected error: ${describeError(e)}`)
    process.exit(1)
  })