import { Pool } from 'pg'

// One connection pool for the whole app. `pg` talks to Neon over a normal
// Postgres URL — no special client needed.
const globalForPg = globalThis as unknown as { pool?: Pool }

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
  })

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool

export type Item = {
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
