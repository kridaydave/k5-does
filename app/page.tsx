'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Check, Sparkles } from 'lucide-react'
import { GlassButton, GlassContent, GlassScene, GlassSurface } from '@glass-sdk/liquid-glass'
import { ReferenceLine } from '@/components/dither-kit/reference-line'
import { AreaChart } from '@/components/dither-kit/area-chart'
import { Area } from '@/components/dither-kit/area'
import { Grid } from '@/components/dither-kit/grid'
import { Legend } from '@/components/dither-kit/legend'
import { BlockLegend } from '@/components/dither-kit/block-legend'
import { Tooltip } from '@/components/dither-kit/tooltip'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
import { Sparkline } from '@/components/dither-kit/sparkline'
import FluidOrb from '@/components/ui/fluid-orb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'

type Item = {
  id: string
  raw_text: string
  kind: string | null
  title: string | null
  body: string | null
  classified_by: string | null
  classified_at: string | null
  status: string
  created_at: string
}

// Tap the badge to cycle through these kinds. 'unknown' is engine-only —
// hand-fix only sets task / doc / note.
const KIND_CYCLE = ['task', 'doc', 'note'] as const
const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  task: 'default',
  doc: 'secondary',
  note: 'outline',
  unknown: 'outline',
}
const KIND_LABEL: Record<string, string> = {
  task: 'Task',
  doc: 'Doc',
  note: 'Note',
  unknown: 'Unknown',
}

// Where the two glows behind the composer rest, then where they wander while
// you type. Plain transforms so every move rides the wrapper's transition
// instead of snapping. First entry is both orbs' resting pose.
const ORB_POSES: [string, string][] = [
  ['translate3d(0, 0, 0)', 'translate3d(0, 0, 0)'],
  ['translate3d(-30px, 34px, 0)', 'translate3d(34px, -28px, 0)'],
  ['translate3d(38px, 6px, 0)', 'translate3d(-30px, -34px, 0)'],
  ['translate3d(-16px, -30px, 0)', 'translate3d(26px, 38px, 0)'],
]

// Build a 7-day capture series from the items, oldest day first.
// `now` is passed in (set after mount) so the time read never happens during
// prerender — the first paint shows an empty chart and fills in immediately.
function buildActivity(items: Item[], now: number) {
  const days: { day: string; label: string; captures: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push({
      day: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      captures: 0,
    })
  }
  const byDay = new Map(days.map((d) => [d.day, d]))
  for (const item of items) {
    const key = item.created_at.slice(0, 10)
    const bucket = byDay.get(key)
    if (bucket) bucket.captures += 1
  }
  return days.map((d) => ({ label: d.label, captures: d.captures }))
}

// Liquid glass needs a WebGPU adapter; without one the library renders a
// faint, broken-looking surface. Detect once on mount and fall back to the
// regular shadcn button so the UI is never degraded.
function useWebGPUSupported() {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.gpu) {
          if (!cancelled) setSupported(false)
          return
        }
        const adapter = await navigator.gpu.requestAdapter()
        if (!cancelled) setSupported(adapter !== null)
      } catch {
        if (!cancelled) setSupported(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return supported
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Read the list off the wire. Returns null when the API is unreachable so
// callers keep the rows they already have instead of blanking the page.
async function fetchItems(): Promise<Item[] | null> {
  const res = await fetch('/api/items').catch(() => null)
  if (!res?.ok) return null
  return (await res.json()) as Item[]
}

// POST /api/items — capture only stores raw_text.
async function capture(raw_text: string) {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text }),
  })
  if (!res.ok) throw new Error(`Capture failed (${res.status})`)
  return res.json()
}

// PATCH /api/items/:id — triage (status) or hand-fix (kind).
async function patchItem(id: string, body: { status?: string; kind?: string }) {
  const res = await fetch(`/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Update failed (${res.status})`)
  return res.json()
}

// DELETE /api/items/:id — hard delete.
async function deleteItem(id: string) {
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed (${res.status})`)
  return res.json()
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneExpanded, setDoneExpanded] = useState(false)
  // Set after mount so the time read never runs during prerender.
  const [now, setNow] = useState<number | null>(null)
  const webgpu = useWebGPUSupported()

  const [typing, setTyping] = useState(false)
  const [pose, setPose] = useState(0)
  const quietTimer = useRef<number | null>(null)

  // Typing moves the backdrop glows. Every keystroke restarts a quiet timer,
  // and while it runs they wander between poses. The timer running out is
  // what sends them home.
  function composeChange(value: string) {
    setText(value)
    if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
    if (!value) {
      setTyping(false)
      setPose(0)
      quietTimer.current = null
      return
    }
    setTyping(true)
    quietTimer.current = window.setTimeout(() => {
      setTyping(false)
      setPose(0)
      quietTimer.current = null
    }, 900)
  }

  useEffect(() => () => {
    if (quietTimer.current !== null) window.clearTimeout(quietTimer.current)
  }, [])

  useEffect(() => {
    if (!typing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      setPose((p) => (p + 1) % ORB_POSES.length)
    }, 1500)
    return () => window.clearInterval(id)
  }, [typing])

  const activity = useMemo(
    () => (now === null ? [] : buildActivity(items, now)),
    [items, now],
  )

  // `activity` is empty until `now` is set after mount, so guard the division
  // instead of handing NaN to the reference line.
  const avgCaptures = activity.length
    ? activity.reduce((sum, day) => sum + day.captures, 0) / activity.length
    : 0

  const taskCount = items.filter((i) => i.kind === 'task').length
  const docCount = items.filter((i) => i.kind === 'doc').length
  const noteCount = items.filter((i) => i.kind === 'note').length
  const unknownCount = items.filter((i) => i.kind === 'unknown').length

  // Captures per calendar day, counted once. The per-item sparklines look up
  // this map instead of rescanning `items` three times per row.
  const capturesByDay = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const key = item.created_at.slice(0, 10)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [items])

  // Three points per item: two days before its creation day, the day before,
  // then the day itself, oldest first so the line reads left to right.
  const itemDailySparklines = useMemo(
    () =>
      items.map((item) => {
        const created = new Date(item.created_at.slice(0, 10))
        return [-2, -1, 0].map((offset) => {
          const d = new Date(created)
          d.setDate(d.getDate() + offset)
          return capturesByDay.get(d.toISOString().slice(0, 10)) ?? 0
        })
      }),
    [items, capturesByDay],
  )

  // Derived sections — inbox is unclassified + open, never stored.
  const inbox = useMemo(
    () => items.filter((i) => i.kind === null && i.status === 'open'),
    [items],
  )
  const open = useMemo(
    () => items.filter((i) => i.kind !== null && i.status === 'open'),
    [items],
  )
  const done = useMemo(() => items.filter((i) => i.status === 'done'), [items])

  // Last triaged = max(classified_at). Explains any pile.
  const lastTriaged = useMemo(() => {
    const times = items
      .map((i) => i.classified_at)
      .filter((t): t is string => t !== null)
    if (times.length === 0) return null
    const max = new Date(Math.max(...times.map((t) => new Date(t).getTime())))
    return max.toISOString()
  }, [items])

  function refresh() {
    fetchItems().then((rows) => rows && setItems(rows))
  }

  useEffect(() => {
    // Read the clock after this effect returns. The prerendered tree has no
    // time in it, so the client timestamp has to land in a later render.
    const id = window.setTimeout(() => setNow(Date.now()), 0)
    refresh()
    // Refetch on tab focus — no polling.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  async function handleCapture() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await capture(text.trim())
      setText('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(item: Item) {
    try {
      await patchItem(item.id, { status: item.status === 'open' ? 'done' : 'open' })
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: i.status === 'open' ? 'done' : 'open' } : i,
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  // Tap badge → cycle kind. Hand-fix locks the row (classified_by = 'user').
  async function handFix(item: Item) {
    const currentKind = item.kind ?? ''
    const idx = KIND_CYCLE.indexOf(currentKind as (typeof KIND_CYCLE)[number])
    const nextKind = KIND_CYCLE[(idx + 1) % KIND_CYCLE.length]
    try {
      const updated = await patchItem(item.id, { kind: nextKind })
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  async function handleDelete(item: Item) {
    const isStructured = item.kind !== null
    const msg = isStructured
      ? 'This item is classified. Title and body will be lost. OK to delete?'
      : 'Delete this capture?'
    if (!window.confirm(msg)) return
    try {
      await deleteItem(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  // The layer the glass sits on top of. Shared by both branches: the library
  // refracts it when a WebGPU adapter exists, `backdrop-filter` blurs it when
  // one doesn't. Without this there is nothing behind the panel to show.
  const captureBackdrop = (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div
        className="absolute -right-16 -top-24 transition-transform duration-[1200ms] ease-in-out"
        style={{ transform: ORB_POSES[pose][0] }}
      >
        <FluidOrb size={200} color="#1A73F2" className="orb-drift-a" />
      </div>
      <div
        className="absolute -bottom-28 -left-20 transition-transform duration-[1200ms] ease-in-out"
        style={{ transform: ORB_POSES[pose][1] }}
      >
        <FluidOrb size={180} color="#7C5CFF" className="orb-drift-b" />
      </div>
    </div>
  )

  // Shared between the glass and plain capture panel; only the button differs.
  const captureBody = (
    <CardContent className="flex flex-col gap-4 pt-4">
      <Textarea
        className="min-h-20 resize-none text-sm"
        placeholder="Type anything — a task, a thought, a link…"
        value={text}
        onChange={(e) => composeChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCapture()
        }}
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">⌘↵ to capture</span>
        {webgpu === true ? (
          <GlassButton
            size="sm"
            onClick={handleCapture}
            disabled={busy || !text.trim()}
            className="font-medium"
          >
            {busy ? 'Capturing…' : 'Capture'}
          </GlassButton>
        ) : (
          <Button onClick={handleCapture} disabled={busy || !text.trim()}>
            {busy ? 'Capturing…' : 'Capture'}
          </Button>
        )}
      </div>
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error} — is DATABASE_URL set and the schema applied?
        </p>
      )}
    </CardContent>
  )

  function renderItem(item: Item, index: number) {
    const isStructured = item.kind !== null
    const kindLabel = isStructured
      ? KIND_LABEL[item.kind ?? 'unknown']
      : 'Unclassified'
    const variant = KIND_VARIANT[item.kind ?? 'unknown'] ?? 'outline'
    const sparkle = itemDailySparklines[index]

    return (
      <li key={item.id}>
        <Card className="py-3 transition-colors hover:bg-accent/50">
          <CardContent className="flex items-start gap-3">
            {/* Hand-fix: tapping the badge cycles task/doc/note */}
            <Badge
              variant={variant}
              className="mt-0.5 shrink-0 cursor-pointer capitalize"
              onClick={() => handFix(item)}
              title="Tap to reclassify"
            >
              {kindLabel}
            </Badge>

            <div className="min-w-0 flex-1">
              {/* A hand-fix sets kind but no title, so structured rows fall back
                  to the raw capture rather than rendering blank. */}
              {isStructured ? (
                <>
                  <p className="text-sm font-medium">{item.title ?? item.raw_text}</p>
                  {item.body && item.body !== item.title && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{item.raw_text}</p>
              )}
              <p className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                {timeAgo(item.created_at)}
                {item.classified_by === 'user' && <span className="text-[10px]">by you</span>}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                {item.classified_by === 'engine' && (
                  <Sparkles className="size-3 text-muted-foreground" aria-label="classified by engine" />
                )}
                {isStructured && (
                  <Button
                    variant={item.status === 'open' ? 'ghost' : 'outline'}
                    size="xs"
                    onClick={() => toggleStatus(item)}
                    title={item.status === 'open' ? 'Mark done' : 'Mark open'}
                  >
                    <Check className="size-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleDelete(item)}
                  title="Delete"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              {/* Three-point sparkline: capture activity around this item's day */}
              <Sparkline
                data={sparkle}
                color="blue"
                variant="dotted"
                className="h-3 w-20 text-[10px]"
              />
            </div>
          </CardContent>
        </Card>
      </li>
    )
  }

  // The rows each section renders are a subset of `items`, so map back to the
  // original index to keep sparklines lined up with their own day.
  const indexOf = new Map(items.map((item, i) => [item.id, i]))
  const renderRows = (rows: Item[]) => rows.map((row) => renderItem(row, indexOf.get(row.id) ?? 0))

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex max-w-md flex-col gap-8 px-4 py-8">
        {/* Header — last triaged timestamp, 7-day sparkline */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">self-os</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastTriaged ? `Last triaged ${timeAgo(lastTriaged)}` : 'No items classified yet'}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="outline" className="gap-1.5 px-2 py-1 text-xs">
              <Sparkles className="size-3.5" />
              {items.length} captured
            </Badge>
            <Sparkline
              data={activity.map((d) => d.captures)}
              color="blue"
              variant="gradient"
              className="h-4 w-24"
            />
          </div>
        </header>

        {/* Capture. Both branches share one composition: a bounded scene, the
            backdrop layer, then the glass panel on top. The library refracts
            that backdrop only when a WebGPU adapter exists, and Firefox on
            Linux has no navigator.gpu at all, so without an adapter the panel
            uses `backdrop-filter` instead. Glass either way. The library sets
            `overflow: visible` from an unlayered rule that beats Tailwind's
            layered utility, so the clip on its scene has to be inline. */}
        {webgpu === true ? (
          <GlassScene
            material="regular"
            appearance="dark"
            className="relative rounded-xl border border-border"
            style={{ overflow: 'hidden' }}
            onDiagnostic={(d) => {
              if (d.error) {
                console.warn('[liquid-glass]', d.error.message)
              }
            }}
          >
            <GlassContent>{captureBackdrop}</GlassContent>
            {/* captureBody lays itself out with `--card-spacing`, which the Card
                component normally declares. Declare it here so the glass and
                plain branches pad identically. */}
            <GlassSurface
              radius={16}
              className="relative [--card-spacing:--spacing(4)] py-(--card-spacing)"
            >
              {captureBody}
            </GlassSurface>
          </GlassScene>
        ) : (
          <div className="relative isolate overflow-hidden rounded-xl border border-border">
            {captureBackdrop}
            <div className="capture-panel relative rounded-xl bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl backdrop-saturate-150 backdrop-brightness-75 [--card-spacing:--spacing(4)] py-(--card-spacing)">
              {captureBody}
            </div>
          </div>
        )}

        {/* Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-40 w-full">
              <AreaChart
                data={activity}
                config={{ captures: { label: 'Captures', color: 'blue' } }}
                bloom="aura"
                margins={{ top: 8, bottom: 4 }}
              >
                <Grid horizontal />
                <XAxis dataKey="label" />
                <YAxis />
                <Legend />
                <Tooltip labelKey="label" variant="frosted-glass" />
                <ReferenceLine y={avgCaptures} label={`avg: ${Math.round(avgCaptures)}/day`} />
                <Area dataKey="captures" variant="gradient" />
              </AreaChart>
            </div>
          </CardContent>
        </Card>

        {/* Kind breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">By kind</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-16 items-center justify-between">
              <span className="text-sm font-medium">task: {taskCount}</span>
              <span className="text-sm font-medium">doc: {docCount}</span>
              <span className="text-sm font-medium">note: {noteCount}</span>
              <span className="text-sm font-medium">unknown: {unknownCount}</span>
            </div>
            <BlockLegend
              config={{
                task: { label: 'Task', color: 'blue' },
                doc: { label: 'Doc', color: 'green' },
                note: { label: 'Note', color: 'purple' },
                unknown: { label: 'Unknown', color: 'grey' },
              }}
            />
          </CardContent>
        </Card>

        <Separator />

        {/* Inbox — unclassified + open, shown as raw text */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Inbox</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {inbox.length} unclassified
            </span>
          </div>
          {inbox.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-8">
                <FluidOrb size={72} color="#1A73F2" />
                <p className="text-xs text-muted-foreground">
                  Nothing waiting. Your first thought goes above.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">{renderRows(inbox)}</ul>
          )}
        </section>

        <Separator />

        {/* Open — classified + open */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Open</h2>
            <span className="font-mono text-xs text-muted-foreground">{open.length} open</span>
          </div>
          {open.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="flex flex-col gap-2">{renderRows(open)}</ul>
          )}
        </section>

        <Separator />

        {/* Done — collapsed by default */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Done</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{done.length} done</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDoneExpanded(!doneExpanded)}
                title={doneExpanded ? 'Collapse' : 'Expand'}
              >
                {doneExpanded ? '−' : '+'}
              </Button>
            </div>
          </div>
          {doneExpanded && done.length > 0 && (
            <ul className="flex flex-col gap-2">{renderRows(done)}</ul>
          )}
        </section>
      </main>
    </div>
  )
}