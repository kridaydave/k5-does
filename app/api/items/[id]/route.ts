import { NextResponse } from 'next/server'
import { pool, type Item } from '@/lib/db'

// PATCH /api/items/:id — triage + hand-fix (phone)
// Accepts `status` (open|done) and/or `kind` (hand-fix). A kind change locks
// the row: classified_by = 'user', classified_at = now(). The engine skips
// user-classified rows forever.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { status, kind } = (await request.json()) as {
    status?: 'open' | 'done'
    kind?: 'task' | 'doc' | 'note' | 'unknown'
  }

  if (!status && !kind) {
    return NextResponse.json({ error: 'status or kind required' }, { status: 400 })
  }

  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  if (status) {
    updates.push(`status = $${i}`)
    values.push(status)
    i++
  }

  if (kind) {
    // Hand-fix: lock the row so the engine never touches it again.
    updates.push(`kind = $${i}`)
    values.push(kind)
    updates.push(`classified_by = 'user'`)
    updates.push(`classified_at = now()`)
    i++
  }

  const { rows } = await pool.query<Item>(
    `update items
       set ${updates.join(', ')}
     where id = $${i}
     returning id, raw_text, kind, title, body, classified_by, classified_at, status, created_at`,
    [...values, id],
  )

  if (rows.length === 0) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 })
  }

  return NextResponse.json(rows[0])
}

// DELETE /api/items/:id — hard delete (phone)
// No soft flag. Identical before and after classification.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { rowCount } = await pool.query('delete from items where id = $1', [id])
  if (rowCount === 0) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 })
  }
  return NextResponse.json({ id, deleted: true })
}
