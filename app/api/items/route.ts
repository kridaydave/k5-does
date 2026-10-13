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
  const { raw_text } = (await request.json()) as { raw_text?: string }
  const text = (raw_text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'raw_text is required' }, { status: 400 })

  const { rows } = await pool.query<Item>(
    `insert into items (raw_text)
     values ($1)
     returning id, raw_text, kind, title, body, classified_by, classified_at, status, created_at`,
    [text],
  )
  return NextResponse.json(rows[0], { status: 201 })
}
