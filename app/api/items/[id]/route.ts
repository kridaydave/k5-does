import { NextResponse } from 'next/server'
import { pool, type Item } from '@/lib/db'

// Postgres raises 22P02 on a non-uuid string, which surfaces as an unhandled
// 500. A bad id in the URL is a client mistake, so it gets a 400 like any other
// malformed input rather than a stack trace.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function badId(id: string) {
  return UUID.test(id)
    ? null
    : NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })
}

// PATCH /api/items/:id — triage + hand-fix (phone)
// Accepts `status` (open|done) and/or `kind` (hand-fix). A kind change locks
// the row: classified_by = 'user', classified_at = now(). The engine skips
// user-classified rows forever.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const invalid = badId(id)
  if (invalid) return invalid

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const status = (body as { status?: unknown })?.status
  const kind = (body as { kind?: unknown })?.kind

  if (!status && !kind) {
    return NextResponse.json({ error: 'status or kind required' }, { status: 400 })
  }

  const validStatuses = new Set(['open', 'done'])
  if (status != null && !validStatuses.has(status as string)) {
    return NextResponse.json({ error: 'status must be open or done' }, { status: 400 })
  }
  // Hand-fix is phone-only; the engine writes via /api/classify. Keep the set
  // limited to what the phone UI can produce.
  const validKinds = new Set(['task', 'doc', 'note'])
  if (kind != null && !validKinds.has(kind as string)) {
    return NextResponse.json({ error: 'kind must be task, doc or note' }, { status: 400 })
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
  const invalid = badId(id)
  if (invalid) return invalid

  const { rowCount } = await pool.query('delete from items where id = $1', [id])
  if (rowCount === 0) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 })
  }
  return NextResponse.json({ id, deleted: true })
}
