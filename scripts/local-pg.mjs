// Local dev database: PGlite (real Postgres in WASM) exposed over a TCP socket,
// so the Next.js app connects with the normal `pg` driver and DATABASE_URL —
// same code path as production Neon. No Docker, no system Postgres, no sudo.
// Not part of the app; a test harness only.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { readFileSync } from 'node:fs'

const PORT = 5433

const db = await PGlite.create()
await db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
console.log('schema applied')

const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' })
await server.start()
console.log(`pglite listening on 127.0.0.1:${PORT}`)

process.on('SIGTERM', async () => {
  await server.stop()
  await db.close()
  process.exit(0)
})
