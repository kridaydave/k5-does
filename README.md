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
(`scripts/local-pg.mjs` runs real Postgres in WASM via PGlite and is not part of the app — but its data dir is persistent, so the same script doubles as the database of a self-hosted install. See [Self-hosted instead](#self-hosted-instead-no-accounts).)

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

Nothing in the logs ever contains your note text, only ids and kinds. The prompt is handed to `opencode run` through a 0600 temp file rather than `argv`, so your raw text is not visible to anything on the box running `ps`. Noted at `promptFor` in the script.

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

## Self-hosted instead (no accounts)

Vercel and Neon both want an account. The same app runs entirely on this box behind three systemd user units:

| Unit | What it runs | Stands in for |
|---|---|---|
| `scripts/selfos-pg.service` | `scripts/local-pg.mjs` — Postgres in WASM on a TCP socket, data persisted in `.local/pgdata` | Neon |
| `scripts/selfos-site.service` | `next start` on 127.0.0.1:3000 | Vercel |
| `scripts/selfos-engine.service` | `scripts/engine.mjs` — one classification pass at boot | *(already local)* |

1. `npm run build` once — the site unit serves the build, it does not create one.
2. Fill in your checkout path in the unit files, copy them to `~/.config/systemd/user/`.
3. Start the stack:

```bash
systemctl --user daemon-reload
systemctl --user enable --now selfos-pg.service selfos-site.service
systemctl --user enable --now selfos-engine.service
journalctl --user -u selfos-pg.service -u selfos-site.service -u selfos-engine.service
```

What is worth knowing:

- The schema is applied on every database boot (`create table if not exists`), so the first boot of `selfos-pg` creates the table. There is no SQL to run by hand.
- Everything persists across restarts in `.local/pgdata`. That directory *is* the database — copy it while the unit is stopped to back up.
- The engine unit ships pointing at a Vercel domain; `SELFOS_API=http://127.0.0.1:3000` is what points it at the local site (commented in the unit).
- The database binds 127.0.0.1 and so does the site, and there is no auth anywhere: change `-H` in the site unit to reach it from a phone, and know that anything on that wifi can then read and write every capture.
