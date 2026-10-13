# self-os

A personal OS — capture anything, triage down to open/done, classify later.

## How it works

One table, two write clients, one background process:

- **Phone** (bookmarked page, no PWA): capture box + three sections — inbox, open, done.
- **Site** (Vercel, public, no auth): stores captures, serves the phone, accepts the engine's classifications.
- **Engine** (desktop box, autostart background process): pulls unclassified captures, classifies each with one `opencode run`, writes results back.

Inbox is a *derived view* — unclassified AND open — never a stored state. The two axes (classification × triage) can never disagree.

## Run it locally

You need a Postgres connection string. Two ways:

**Neon (same as production):**
1. Create a project at neon.tech, copy the connection string.
2. Run `db/schema.sql` in Neon's SQL editor.
3. `cp .env.example .env.local`, paste the string as `DATABASE_URL`.
4. `npm run dev`, open http://localhost:3000.

**No cloud account yet — local Postgres with zero installs:**
```
node scripts/local-pg.mjs &                      # real Postgres in WASM on :5433
DATABASE_URL="postgresql://selfos:***@127.0.0.1:5433/selfos" npm run dev
```
(`scripts/local-pg.mjs` uses PGlite and is a dev harness, not part of the app.)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/items` | Capture — stores `raw_text` only |
| `GET` | `/api/items` | List (50 cap) — phone sections are derived client-side |
| `PATCH` | `/api/items/:id` | Triage (`status` open/done) or hand-fix (`kind`) |
| `DELETE` | `/api/items/:id` | Hard delete (confirm on structured items) |
| `GET` | `/api/queue` | Unclassified items, oldest first (engine pulls) |
| `POST` | `/api/classify` | Atomic write-back of classifications (engine pushes) |

No auth on any endpoint.

## The engine

A background process on the desktop box, started at boot. One pass per boot:
1. `GET /api/queue` — all unclassified rows, oldest first.
2. For each row, one `opencode run` on a pinned free-tier model.
3. `POST /api/classify` with everything at once — results land atomically.

Hand-fix is final: setting `kind` on the phone sets `classified_by = 'user'`, and the engine skips those rows forever.

## Deploy to Vercel

1. Push to GitHub, import into Vercel.
2. Set `DATABASE_URL` in Vercel env vars (Neon string).
3. Run `db/schema.sql` in Neon's SQL editor (Vercel doesn't run migrations for you).
4. Done — the build needs no env vars, only runtime does.
