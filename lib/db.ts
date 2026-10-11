import { Pool } from 'pg'

// One connection pool for the whole app. `pg` talks to Neon over a normal
// Postgres URL — no special client needed.
const globalForPg = globalThis as unknown as { pool?: Pool }

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon requires SSL; sslmode=require is encoded in the URL, this belt-and-suspenders
    // keeps it working if you paste a URL without it.
    ssl: process.env.DATABASE_URL?.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
  })

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool

export type Item = {
  id: string
  raw_text: string
  kind: string
  title: string
  body: string
  structured_by: string
  created_at: string
}
