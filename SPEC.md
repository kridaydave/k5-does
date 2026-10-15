# self-os spec

A personal capture and triage tool. Kriday captures anything from his phone, triages items to open or done, and a desktop process classifies them in the background. Single user. Public URL. No auth.

## Pieces

Three parts, each with one job.

- Phone: a bookmarked page. Shows a capture box and four sections.
- Site: hosted on Vercel with Neon Postgres. Stores captures, serves the phone, accepts classifications from the engine.
- Engine: a background process on the desktop box. Runs once per boot. Pulls unclassified rows, classifies each, writes results back.

## Data model

One table, `items`. Two independent axes.

- `kind`: nullable. Null means unclassified. Values: task, doc, note, unknown.
- `status`: open or done.

Inbox is not a column. It is a view: unclassified and open. Storing it would let the two axes disagree, so it stays derived.

Other columns: raw_text, title, body (nullable), classified_by (engine or user), classified_at, created_at, updated_at.

`classified_by = 'user'` is a hand-fix lock. The engine skips those rows forever.

## Capture

POST stores raw_text only. No classification at capture time. The in-site classifier is gone.

## Triage

PATCH sets status to open or done. PATCH can also set kind. Setting kind from the phone sets classified_by to user and locks the row.

DELETE is a hard delete. A confirm tap is only needed on structured items.

## Classification engine

Runs once per boot as a systemd user unit.

1. GET /api/queue returns unclassified rows, oldest first. Every row comes back.
2. For each row, one opencode run on a pinned model. The default is cat-jam-free.
3. Collect all results. POST /api/classify once, atomically.

Every pulled row gets a verdict this run. Unknown is a verdict, not an omission. One attempt per item, then unknown. Whole backlog per run, no budget.

Failure handling. Network down during a run: in-memory retry with backoff, then drop the run. The rows stay unclassified and the next boot re-pulls them. No local state file.

Locks. Rows with classified_by = user are never reclassified.

Exit codes. The process exits non-zero when the site is unreachable, when every item fails, or when the queue comes back malformed. Silent success is never allowed.

## Endpoints

- POST /api/items: capture, stores raw_text only.
- GET /api/items: list, 50 cap. Phone sections are derived client-side.
- PATCH /api/items/:id: triage status or hand-fix kind.
- DELETE /api/items/:id: hard delete.
- GET /api/queue: unclassified rows, oldest first.
- POST /api/classify: atomic write-back of results and run stats.

No auth on any endpoint.

## Phone UI

Four sections. Capture box on top.

- Inbox: unclassified captures, shown as raw text.
- Open: classified items.
- Done: collapsed by default.

Unclassified items are fully triageable. Done and delete work on them before classification.

Page refetches on tab focus. No polling. Last triaged timestamp is shown.

Hand-fix cycles the kind badge from the phone.

## Deployment

- Database: Neon Free via the Vercel Marketplace. aws-ap-southeast-1. No expiry, 0.5 GB.
- Host: Vercel. Build needs no env vars, runtime needs DATABASE_URL.
- Run db/schema.sql in Neon once.
- Engine: systemd user unit on the desktop box, started at boot.

## Non-goals

- No login, accounts, or multi-user.
- No PWA install. Bookmarked page only.
- No due dates, projects, tags, or recurring tasks.
- No classification on the phone or in the hosted app.
- No soft delete.

## Verified choices

- Headless opencode works for this. One-shot runs on free-tier models, about four seconds per capture. cline was ruled out because it bills usage.
- Neon over Supabase, because Supabase pauses after seven days idle and cold-starts for ten to thirty seconds.
- The desktop side starts on boot as a quiet process, not a hand-triggered command.