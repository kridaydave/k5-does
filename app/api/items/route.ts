import { NextResponse } from 'next/server'
import { pool, type Item } from '@/lib/db'
import { structureCapture } from '@/lib/structure'

export async function GET() {
  const { rows } = await pool.query<Item>(
    'select id, raw_text, kind, title, body, created_at from items order by created_at desc limit 50',
  )
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const { raw_text } = (await request.json()) as { raw_text?: string }
  const text = (raw_text ?? '').trim()
  if (!text) return NextResponse.json({ error: 'raw_text is required' }, { status: 400 })

  const structured = structureCapture(text)

  const { rows } = await pool.query<Item>(
    `insert into items (raw_text, kind, title, body)
     values ($1, $2, $3, $4)
     returning id, raw_text, kind, title, body, created_at`,
    [text, structured.kind, structured.title, structured.body],
  )
  return NextResponse.json(rows[0], { status: 201 })
}
