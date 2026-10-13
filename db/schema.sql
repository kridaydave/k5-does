-- v2 schema: one table, two write clients, one background engine.
-- Run once against your Neon database (SQL editor in the Neon console).
-- Fresh database in Neon — v0 rows are intentionally not migrated.

create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  raw_text      text        not null,            -- exactly what you typed
  kind          text        null,                -- task | doc | note | unknown; null = unclassified
  title         text        null,                -- engine or hand output; null until classified
  body          text        null,                -- engine or hand output; null until classified
  classified_by text        null,                -- 'engine' | 'user'; null until classified
  classified_at timestamptz null,                -- set by engine or hand-fix
  status        text        not null default 'open', -- open | done
  created_at    timestamptz not null default now()
);

-- The queue: unclassified items, smallest possible index for the engine to pull.
create index if not exists items_queue_idx on items (created_at) where kind is null;
create index if not exists items_created_at_idx on items (created_at desc);
create index if not exists items_status_idx on items (status);
