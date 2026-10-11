'use client'

import { useEffect, useState } from 'react'

type Item = {
  id: string
  raw_text: string
  kind: string
  title: string
  body: string
  created_at: string
}

const KIND_STYLES: Record<string, string> = {
  task: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  doc: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  note: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  unknown: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/items')
    if (res.ok) setItems(await res.json())
  }

  useEffect(() => {
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

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            self-os
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Capture anything. It gets structured for you.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <textarea
            className="h-28 w-full resize-none rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-600"
            placeholder="Type anything — a task, a thought, a link…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) capture()
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">⌘↵ to capture</span>
            <button
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
              onClick={capture}
              disabled={busy || !text.trim()}
            >
              {busy ? 'Structuring…' : 'Capture'}
            </button>
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error} — is DATABASE_URL set and the schema applied?
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-2">
          {items.length === 0 && (
            <li className="py-8 text-center text-sm text-zinc-400">
              Nothing captured yet.
            </li>
          )}
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span
                className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${KIND_STYLES[item.kind] ?? KIND_STYLES.unknown}`}
              >
                {item.kind}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {item.title}
                </p>
                {item.body !== item.title && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {item.body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
