import { NextResponse } from 'next/server'
import { pool, type Item } from '@/lib/db'

// GET /api/queue — pull (engine)
// Returns unclassified rows (kind is null), oldest first.
// No status filter: done-but-unclassified items get auto-classified too, so the
// done section never shows bare raw text.
// Returns id, raw_text, created_at only — kind/title/body are outputs.
export async function GET() {
  const { rows } = await pool.query<Pick<Item, 'id' | 'raw_text' | 'created_at'>>(
    'select id, raw_text, created_at from items where kind is null order by created_at asc',
  )
  return NextResponse.json(rows)
}
