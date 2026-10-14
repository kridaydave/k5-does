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

Before pushing, `npm run typecheck` and `npm run lint` are both clean gates.

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

`scripts/engine.mjs` is the process that actually classifies. It lives on the desktop box and runs once at boot. One pass, then exit:

1. `GET /api/queue` — all unclassified rows, oldest first.
2. For each row, one `opencode run` on a free-tier model.
3. `POST /api/classify` with everything at once — results land atomically.

Hand-fix is final: setting `kind` on the phone sets `classified_by = 'user'`, and the engine skips those rows forever.

| Env var | Default | What it does |
|---|---|---|
| `SELFOS_API` | `http://127.0.0.1:3000` | Where the site is served |
| `SELFOS_MODEL` | `opencode/cat-jam-free` | Which model classifies |
| `SELFOS_DRY_RUN` | unset | `1` uses a local keyword heuristic and makes zero AI calls, so you can test the loop without burning tokens |

Nothing in the logs ever contains your note text, only ids and kinds. Raw text does ride in `argv` while `opencode run` runs, so anything on the box running `ps` can see it for those few seconds. Noted at `promptFor` in the script if that ever needs to change.

### Run it once by hand

```bash
SELFOS_API=http://localhost:3000 node scripts/engine.mjs
SELFOS_API=http://localhost:3000 SELFOS_DRY_RUN=1 node scripts/engine.mjs   # no AI calls
```

Non-zero exit means something went wrong: the site was unreachable, every item failed, or the queue came back malformed. That is deliberate, a boot process that fails quietly is worse than one that shows up red.

### Run it at boot

`scripts/selfos-engine.service` is a systemd user unit. Fill in your checkout path and your site URL, copy it to `~/.config/systemd/user/`, then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now selfos-engine.service
journalctl --user -u selfos-engine.service
```

## Deploy to Vercel

1. Push to GitHub, import into Vercel.
2. Set `DATABASE_URL` in Vercel env vars (Neon string).
3. Run `db/schema.sql` in Neon's SQL editor (Vercel doesn't run migrations for you).
4. Done — the build needs no env vars, only runtime does.
