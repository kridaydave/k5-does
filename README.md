# self-os

A personal OS — v0 is one loop: **capture → structure → show**.

## What's here (v0)

- `app/page.tsx` — the capture UI. One textarea, one button, one list.
- `app/api/items/route.ts` — `GET` lists the last 50 items, `POST` captures one.
- `lib/structure.ts` — **the AI seam.** One function that turns raw text into
  `{ kind, title, body }`. Today it's a keyword heuristic so the app runs with
  zero API keys. When you're ready, replace this one function with an ACP
  session or a model API call — nothing else in the app changes. That's the
  whole trick: all AI logic lives behind one seam.
- `lib/db.ts` — one Postgres pool (works with Neon or local).
- `db/schema.sql` — one table. That's the entire database for now.

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
DATABASE_URL="postgresql://selfos:selfos@127.0.0.1:5433/selfos" npm run dev
```
(`scripts/local-pg.mjs` uses PGlite and is a dev harness, not part of the app.)

## Deploy to Vercel

1. Push to GitHub, import into Vercel.
2. Set `DATABASE_URL` in Vercel env vars (Neon string).
3. Run `db/schema.sql` in Neon's SQL editor (Vercel doesn't run migrations for you).
4. Done — the build needs no env vars, only runtime does.

## What v0 deliberately does NOT have

No auth, no search, no event bus, no perms, no second app. Capture-to-list is
the whole thing. Each of those becomes its own small version later, once the
loop is proven.

## The next slice (v1 candidates, in order)

1. Real AI structuring in `lib/structure.ts` (ACP or a model API — same seam).
2. Search over items (Postgres `tsvector` first, vectors later if needed).
3. A second app (docs) to prove the "one kernel, many apps" idea.
