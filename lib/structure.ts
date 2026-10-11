// The AI seam. `structureCapture` turns raw text into { kind, title, body }.
// The rest of the app only ever talks to this function — that's the whole
// trick of an AI-native app: one seam, swappable implementations.
//
// Two implementations, same shape:
//   1. Anthropic API (when ANTHROPIC_API_KEY is set) — the real thing.
//   2. Keyword heuristic (no key) — so the app runs in any environment.
//
// If the model call fails for any reason, we FALL BACK to the heuristic and
// mark the item with structured_by so you can see what happened. The capture
// loop never breaks because a model was down.

export type Structured = {
  kind: 'task' | 'doc' | 'note' | 'unknown'
  title: string
  body: string
  // Which implementation produced this — 'ai' or 'heuristic'.
  structured_by: 'ai' | 'heuristic'
}

const TASK_WORDS = ['todo', 'task', 'remind', 'buy', 'call', 'email', 'fix', 'ship', 'pay', 'book']

export function structureHeuristic(raw: string): Structured {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const kind: Structured['kind'] = TASK_WORDS.some((w) => lower.includes(w)) ? 'task' : 'note'

  // First sentence or ~60 chars, whichever is shorter, as the title.
  const firstSentence = text.split(/(?<=[.!?])\s/)[0]
  const title = (firstSentence.length > 60 ? firstSentence.slice(0, 57) + '…' : firstSentence) || 'Untitled'

  return { kind, title, body: text, structured_by: 'heuristic' }
}

const PROMPT = `You structure captured thoughts for a personal OS. Given raw text, reply with ONLY a JSON object (no markdown fence, no commentary):

{"kind": "task" | "doc" | "note" | "unknown", "title": "<short title, max 60 chars>", "body": "<cleaned-up body>"}

Rules:
- task = something to do. doc = reference material worth keeping (a link, a recipe, notes). note = a thought or observation. unknown = doesn't fit.
- title: concise summary, no quotes inside.
- body: the original text, lightly cleaned (fixed typos OK, never invent content).
- If the text is a task, keep the body as-is.`

async function structureWithAnthropic(raw: string): Promise<Structured> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
      max_tokens: 300,
      system: PROMPT,
      messages: [{ role: 'user', content: raw }],
    }),
    // Never let a slow model hang the capture request.
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    content: { type: string; text?: string }[]
  }
  const text = data.content.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('anthropic returned no text')

  // Tolerate a stray markdown fence if the model adds one anyway.
  const json = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(json) as { kind?: string; title?: string; body?: string }

  const validKinds = ['task', 'doc', 'note', 'unknown']
  return {
    kind: (validKinds.includes(parsed.kind ?? '') ? parsed.kind : 'unknown') as Structured['kind'],
    title: (parsed.title || '').slice(0, 60) || 'Untitled',
    body: parsed.body || raw,
    structured_by: 'ai',
  }
}

export async function structureCapture(raw: string): Promise<Structured> {
  if (!process.env.ANTHROPIC_API_KEY) return structureHeuristic(raw)
  try {
    return await structureWithAnthropic(raw)
  } catch (e) {
    // Log loudly, degrade gracefully — the capture always succeeds.
    console.error('[structure] AI call failed, falling back to heuristic:', e instanceof Error ? e.message : e)
    return structureHeuristic(raw)
  }
}
