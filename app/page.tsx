'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Trash2, Check, Plus, Minus } from 'lucide-react'
import { GlassButton, GlassContent, GlassScene } from '@glass-sdk/liquid-glass'
import { DitherAvatar } from '@/components/dither-kit/avatar'
import { DitherGradient } from '@/components/dither-kit/gradient'
import { Sparkline } from '@/components/dither-kit/sparkline'
import FluidOrb from '@/components/ui/fluid-orb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'

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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// The liquid-glass surfaces need a WebGPU adapter. Without one the library
// renders a faint broken-looking sheet, so the glass path is gated and the
// plain shadcn button renders instead. Never a degraded UI.
function useWebGPUSupported() {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
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

// Captures per day for the last 14 days, oldest first. Drives the header
// sparkline so the header answers "am I actually using this" without a click.
//
// This reads the clock, so it must not run during the prerender: Next evaluates
// client components at build time and rejects Date.now() there as unstable.
const subscribeNothing = () => () => {}

// Captures per day for the last 14 days, oldest first.
function buildActivity(items: Item[]): number[] {
  const now = Date.now()
  const days = 14
  const buckets = new Array<number>(days).fill(0)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const midnight = startOfToday.getTime()
  for (const item of items) {
    const at = new Date(item.created_at).getTime()
    if (Number.isNaN(at)) continue
    // Anything later today is negative against midnight, and has to clamp to
    // today rather than fall out of the window. Captures between 00:00 and
    // now are the common case, so without the clamp every card lands in no
    // bucket and the sparkline renders flat.
    const daysAgo = Math.max(0, Math.floor((midnight - at) / 86400000))
    if (daysAgo < days) buckets[days - 1 - daysAgo] += 1
  }
  return buckets
}

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
  const webgpu = useWebGPUSupported()

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

  // Gated on hydration: the sparkline reads the clock, and Next prerenders
  // client components at build time, so it has to stay out of that pass.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )
  const activity = useMemo(() => (hydrated ? buildActivity(items) : []), [hydrated, items])

  function refresh() {
    fetchItems().then((rows) => rows && setItems(rows))
  }

  // Refetch on tab focus — no polling.
  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
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

  function renderItem(item: Item) {
    const isStructured = item.kind !== null
    const kindLabel = isStructured ? KIND_LABEL[item.kind ?? 'unknown'] : 'Unclassified'
    const variant = KIND_VARIANT[item.kind ?? 'unknown'] ?? 'outline'

    return (
      <li key={item.id}>
        <Card className="py-3 transition-colors hover:border-foreground/20">
          <CardContent className="flex items-start gap-3">
            {/* Seeded on the id, so an item keeps the same face across loads. */}
            <DitherAvatar name={item.id} size={28} className="mt-0.5 shrink-0" />

            {/* Hand-fix: tapping the badge cycles task/doc/note */}
            <Badge
              variant={variant}
              className="mt-1 shrink-0 cursor-pointer capitalize"
              onClick={() => handFix(item)}
              title="Tap to reclassify"
            >
              {kindLabel}
            </Badge>

            <div className="min-w-0 flex-1">
              {isStructured ? (
                <>
                  {/* A hand-fix sets kind but never sets a title, so fall back to
                      the raw text rather than rendering an empty card. */}
                  <p className="text-sm font-medium">{item.title ?? item.raw_text}</p>
                  {/* Only worth a second line when it says something the title
                      does not. The dry-run heuristic sets body to a copy of the
                      raw text, which would otherwise print the same words twice. */}
                  {item.body && item.body !== item.title && item.body !== item.raw_text && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{item.raw_text}</p>
              )}
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {timeAgo(item.created_at)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
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
          </CardContent>
        </Card>
      </li>
    )
  }

  function lane(title: string, count: string, children: React.ReactNode) {
    return (
      <section className="flex min-h-0 flex-col lg:border-r lg:border-border/40 lg:last:border-r-0">
        <div className="flex items-baseline justify-between px-1 pb-2">
          <h2 className="text-sm font-medium">{title}</h2>
          <span className="font-mono text-xs text-muted-foreground">{count}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-6 pr-1">{children}</div>
      </section>
    )
  }

  function emptyLane() {
    return <p className="px-1 py-2 text-xs text-muted-foreground">Nothing here.</p>
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* A low wash behind the header only. Kept faint on purpose: it has to
          sit under body text without costing contrast. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-[0.10]">
        <DitherGradient from="purple" to="transparent" direction="down" cell={4} />
      </div>

      {/* Header — last triaged timestamp and a sparkline of capture activity */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div>
          <h1 className="text-xl font-semibold">self-os</h1>
          <p className="text-xs text-muted-foreground">
            {lastTriaged ? `Last triaged ${timeAgo(lastTriaged)}` : 'No items classified yet'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activity.some((n) => n > 0) && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                14d
              </span>
              <Sparkline
                data={activity}
                color="purple"
                variant="dotted"
                className="h-8 w-28"
              />
            </div>
          )}
          <Badge variant="outline" className="gap-1 px-2 py-1 text-xs">
            {items.length} total
          </Badge>
        </div>
      </header>

      {error && (
        <p className="relative z-10 mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Capture box — raw_text only, no classification at capture time */}
      <div className="relative z-10 px-4 py-3">
        {webgpu === true ? (
          <GlassScene
            material="regular"
            appearance="dark"
            className="relative overflow-hidden rounded-xl border border-border"
            onDiagnostic={(d) => {
              if (d.error) console.warn('[liquid-glass]', d.error.message)
            }}
          >
            <GlassContent>
              {/* Something for the glass to refract. Without this the button
                  has a flat black sheet behind it. */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -right-16 -top-24">
                  <FluidOrb size={200} color="#7C5CFF" />
                </div>
                <div className="absolute -bottom-28 -left-20">
                  <FluidOrb size={180} color="#1A73F2" />
                </div>
              </div>
            </GlassContent>

            <div className="relative flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
              <Textarea
                className="min-h-20 resize-none text-sm sm:min-h-16"
                placeholder="Type anything — a task, a thought, a link…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCapture()
                }}
              />
              <GlassButton
                onClick={handleCapture}
                disabled={busy || !text.trim()}
                className="h-8 shrink-0 px-3 text-sm"
              >
                {busy ? 'Capturing…' : 'Capture'}
              </GlassButton>
            </div>
          </GlassScene>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-end">
              <Textarea
                className="min-h-20 resize-none text-sm sm:min-h-16"
                placeholder="Type anything — a task, a thought, a link…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCapture()
                }}
              />
              <Button
                size="sm"
                onClick={handleCapture}
                disabled={busy || !text.trim()}
                className="h-8 shrink-0"
              >
                {busy ? 'Capturing…' : 'Capture'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Three lanes, one per triage state. Stacks to a single column on a
          phone, which is the shape this is actually used in. */}
      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-y-4 px-4 lg:grid-cols-3 lg:gap-x-4">
        {lane(
          'Inbox',
          `${inbox.length} unclassified`,
          inbox.length === 0 ? (
            emptyLane()
          ) : (
            <ul className="flex flex-col gap-2">{inbox.map(renderItem)}</ul>
          ),
        )}

        {lane(
          'Open',
          `${open.length} open`,
          open.length === 0 ? (
            emptyLane()
          ) : (
            <ul className="flex flex-col gap-2">{open.map(renderItem)}</ul>
          ),
        )}

        <section className="flex min-h-0 flex-col lg:border-r-0">
          <div className="flex items-baseline justify-between px-1 pb-2">
            <h2 className="text-sm font-medium">Done</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {done.length} done
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDoneExpanded(!doneExpanded)}
                title={doneExpanded ? 'Collapse' : 'Expand'}
              >
                {doneExpanded ? <Minus className="size-3" /> : <Plus className="size-3" />}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6 pr-1">
            {doneExpanded && done.length > 0 ? (
              <ul className="flex flex-col gap-2">{done.map(renderItem)}</ul>
            ) : doneExpanded ? (
              emptyLane()
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}