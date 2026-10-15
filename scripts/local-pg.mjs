// Local database: PGlite (real Postgres compiled to WASM) exposed over a TCP
// socket, so the app connects with the normal `pg` driver and a normal
// DATABASE_URL. Same code path as production Neon. No Docker, no system
// Postgres, no sudo.
//
// The data directory defaults to .local/pgdata, which is what makes this usable
// as an actual deployment rather than a throwaway test harness: an in-memory
// database loses every capture the moment the process exits.
//
//   node scripts/local-pg.mjs                     # persistent, on 127.0.0.1:5433
//   SELFOS_LOCAL_PG_PORT=5444 node scripts/local-pg.mjs   # second checkout
//   SELFOS_PGDATA=/somewhere/else node scripts/local-pg.mjs
//
// SELFOS_PG_BIND=0.0.0.0 listens on every interface, which is only needed when
// something on another machine talks to this database (a second laptop running
// its own site against these captures, say). A phone reaching the *site* needs
// nothing here — that is the site unit's -H flag. Off by default either way:
// this is a database with no auth on it.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The port is overridable so two checkouts can each run their own database —
// two sessions on one box otherwise fight over 5433 and the second dies on
// EADDRINUSE.
const PORT = Number(process.env.SELFOS_LOCAL_PG_PORT ?? 5433)
const BIND = process.env.SELFOS_PG_BIND ?? '127.0.0.1'
const DATA_DIR = resolve(process.env.SELFOS_PGDATA ?? '.local/pgdata')

mkdirSync(DATA_DIR, { recursive: true })

const db = await PGlite.create(DATA_DIR)

// The schema is idempotent (if not exists), so applying it on every boot is how a
// fresh clone gets its table without a separate migration step.
await db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
console.log(`schema applied, data in ${DATA_DIR}`)

const server = new PGLiteSocketServer({ db, port: PORT, host: BIND })
await server.start()
console.log(`pglite listening on ${BIND}:${PORT}`)

let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  // Closing the db flushes the data directory. Without this the last writes can
  // be lost on a hard stop, which is the whole reason the data dir exists.
  await server.stop()
  await db.close()
  console.log('pglite stopped cleanly')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
