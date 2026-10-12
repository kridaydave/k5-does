'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { GlassButton, GlassContent, GlassScene } from '@glass-sdk/liquid-glass'
import { AreaChart } from '@/components/dither-kit/area-chart'
import { Area } from '@/components/dither-kit/area'
import { Grid } from '@/components/dither-kit/grid'
import { Legend } from '@/components/dither-kit/legend'
import { Tooltip } from '@/components/dither-kit/tooltip'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
import FluidOrb from '@/components/ui/fluid-orb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Item = {
  id: string
  raw_text: string
  kind: string
  title: string
  body: string
  structured_by: string
  created_at: string
}

const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  task: 'default',
  doc: 'secondary',
  note: 'outline',
  unknown: 'outline',
}

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
  return days.map(({ day: _day, ...rest }) => rest)
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

export default function Home() {
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set after mount so the time read never runs during prerender.
  const [now, setNow] = useState<number | null>(null)
  const webgpu = useWebGPUSupported()
  const activity = useMemo(
    () => (now === null ? [] : buildActivity(items, now)),
    [items, now],
  )

  async function load() {
    const res = await fetch('/api/items')
    if (res.ok) setItems(await res.json())
  }

  useEffect(() => {
    setNow(Date.now())
    load()
  }, [])

  async function capture() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: text }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Failed (${res.status})`)
      }
      setText('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const taskCount = items.filter((i) => i.kind === 'task').length

  // Shared between the glass and plain capture card; only the button differs.
  const captureBody = (
    <CardContent className="flex flex-col gap-4 pt-6">
      <Textarea
        className="min-h-24 resize-none text-sm"
        placeholder="Type anything — a task, a thought, a link…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) capture()
        }}
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">⌘↵ to capture</span>
        {webgpu === true ? (
          <GlassButton size="sm" onClick={capture} disabled={busy || !text.trim()} className="font-medium">
            {busy ? 'Structuring…' : 'Capture'}
          </GlassButton>
        ) : (
          <Button onClick={capture} disabled={busy || !text.trim()}>
            {busy ? 'Structuring…' : 'Capture'}
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

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-14">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">self-os</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Capture anything. It gets structured for you.
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5 px-3 py-1.5">
            <Sparkles className="size-3.5" />
            {items.length} captured
          </Badge>
        </header>

        {/* Capture */}
        {webgpu === true ? (
          <GlassScene
            material="regular"
            className="relative overflow-hidden rounded-xl border border-border"
            onDiagnostic={(d) => {
              if (d.error) {
                console.warn('[liquid-glass]', d.error.message)
              }
            }}
          >
            <GlassContent>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -right-16 -top-24">
                  <FluidOrb size={200} color="#1A73F2" />
                </div>
                <div className="absolute -bottom-28 -left-20">
                  <FluidOrb size={180} color="#7C5CFF" />
                </div>
              </div>
            </GlassContent>
            <Card className="relative border-0 bg-transparent shadow-none">
              {captureBody}
            </Card>
          </GlassScene>
        ) : (
          <Card>{captureBody}</Card>
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
                <Area dataKey="captures" variant="gradient" />
              </AreaChart>
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Recent</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {taskCount} task{taskCount === 1 ? '' : 's'}
            </span>
          </div>
          {items.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-10">
                <FluidOrb size={72} color="#1A73F2" />
                <p className="text-sm text-muted-foreground">
                  Nothing captured yet. Your first thought goes above.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardContent className="flex items-start gap-3 py-4">
                      <Badge variant={KIND_VARIANT[item.kind] ?? 'outline'} className="mt-0.5 shrink-0">
                        {item.kind}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.body !== item.title && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                        )}
                      </div>
                      <span className="flex shrink-0 items-center gap-2">
                        {item.structured_by === 'ai' && (
                          <Sparkles className="size-3 text-muted-foreground" aria-label="structured by AI" />
                        )}
                        <span className="font-mono text-xs text-muted-foreground">
                          {timeAgo(item.created_at)}
                        </span>
                      </span>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
