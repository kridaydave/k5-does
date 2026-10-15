import { NextResponse } from 'next/server'
import { pool, type Item } from '@/lib/db'

// GET /api/items — list (phone)
// Returns rows for the page's sections. 50-row cap; "last triaged" timestamp
// explains any pile.
export async function GET() {
  const { rows } = await pool.query<Item>(
    'select id, raw_text, kind, title, body, classified_by, classified_at, status, created_at from items order by created_at desc limit 50',
  )
  return NextResponse.json(rows)
}

// POST /api/items — capture (phone)
// Stores raw_text only. Everything else is null/default. No classification
// happens here — the engine classifies asynchronously.
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const raw_text = (body as { raw_text?: unknown })?.raw_text
  if (typeof raw_text !== 'string') {
    return NextResponse.json({ error: 'raw_text must be a string' }, { status: 400 })
  }
  const text = raw_text.trim()
  if (!text) return NextResponse.json({ error: 'raw_text is required' }, { status: 400 })

  const { rows } = await pool.query<Item>(
    `insert into items (raw_text)
     values ($1)
     returning id, raw_text, kind, title, body, classified_by, classified_at, status, created_at`,
    [text],
  )
  return NextResponse.json(rows[0], { status: 201 })
}
