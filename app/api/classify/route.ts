import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// POST /api/classify — write-back (engine)
// Atomic: results and run stats land together. A half-landed run is impossible.
// Each result sets kind, title, body, classified_by='engine', classified_at=now().
// Rows with classified_by='user' are skipped even if the engine sends a result.
// Unclassifiable items come back as kind='unknown' with best-effort title/body.

type ClassifyResult = {
  id: string
  kind: string
  title?: string | null
  body?: string | null
}

type ClassifyRequest = {
  started_at?: string
  finished_at?: string
  failure_count?: number
  results: ClassifyResult[]
}

type ClassifyResponse = {
  updated: number
  skipped: number
  failure_count: number
  classified_at: string
}

export async function POST(request: Request) {
  const { failure_count = 0, results } = (await request.json()) as ClassifyRequest

  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: 'results required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('begin')

    const classified_at = new Date().toISOString()
    let updated = 0
    let skipped = 0

    // Process each result in the transaction. An update that touches 0 rows
    // either doesn't exist (defensive) or was skipped by a hand-fix.
    for (const result of results) {
      const { rowCount } = await client.query(
        `update items
          set kind = $1,
              title = $2,
              body = $3,
              classified_by = 'engine',
              classified_at = $4
         where id = $5
           and classified_by is distinct from 'user'`,
        [result.kind, result.title ?? null, result.body ?? null, classified_at, result.id],
      )

      if (rowCount === 1) {
        updated++
      } else {
        skipped++
      }
    }

    await client.query('commit')
    return NextResponse.json({
      updated,
      skipped,
      failure_count,
      classified_at,
    } as ClassifyResponse)
  } catch (e) {
    await client.query('rollback')
    console.error('[classify] transaction failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'classification write-back failed' }, { status: 500 })
  } finally {
    client.release()
  }
}
