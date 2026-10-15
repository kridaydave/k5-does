'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trash2, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
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
    const kindLabel = isStructured
      ? KIND_LABEL[item.kind ?? 'unknown']
      : 'Unclassified'
    const variant = KIND_VARIANT[item.kind ?? 'unknown'] ?? 'outline'

    return (
      <li key={item.id}>
        <Card className="py-3">
          <CardContent className="flex items-start gap-3">
            {/* Hand-fix: tapping the badge cycles task/doc/note */}
            <Badge
              variant={variant}
              className="mt-0.5 cursor-pointer capitalize"
              onClick={() => handFix(item)}
              title="Tap to reclassify"
            >
              {kindLabel}
            </Badge>

            <div className="min-w-0 flex-1">
              {isStructured ? (
                <>
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.body && item.body !== item.title && (
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

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-md px-4 py-8">
        {/* Header — last triaged timestamp */}
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">self-os</h1>
            <p className="text-xs text-muted-foreground">
              {lastTriaged
                ? `Last triaged ${timeAgo(lastTriaged)}`
                : 'No items classified yet'}
            </p>
          </div>
          <Badge variant="outline" className="gap-1 px-2 py-1 text-xs">
            {items.length} total
          </Badge>
        </header>

        {error && (
          <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Capture box — raw_text only, no classification at capture time */}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 pt-4">
            <Textarea
              className="min-h-20 resize-none text-sm"
              placeholder="Type anything — a task, a thought, a link…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCapture()
              }}
            />
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                ⌘↵ to capture
              </span>
              <Button
                size="sm"
                onClick={handleCapture}
                disabled={busy || !text.trim()}
              >
                {busy ? 'Capturing…' : 'Capture'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Inbox — unclassified + open, shown as raw text */}
        <section className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Inbox</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {inbox.length} unclassified
            </span>
          </div>
          {inbox.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="flex flex-col gap-2">{inbox.map(renderItem)}</ul>
          )}
        </section>

        <Separator className="my-4" />

        {/* Open — classified + open */}
        <section className="mb-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Open</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {open.length} open
            </span>
          </div>
          {open.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="flex flex-col gap-2">{open.map(renderItem)}</ul>
          )}
        </section>

        <Separator className="my-4" />

        {/* Done — collapsed by default */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
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
                {doneExpanded ? '−' : '+'}
              </Button>
            </div>
          </div>
          {doneExpanded && done.length > 0 && (
            <ul className="flex flex-col gap-2">{done.map(renderItem)}</ul>
          )}
        </section>
      </main>
    </div>
  )
}
