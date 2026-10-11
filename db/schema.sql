-- v0 schema: one table is the whole database.
-- Run this once against your Neon database (SQL editor in the Neon console).

create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  raw_text    text        not null,           -- exactly what you typed
  kind        text        not null,           -- task | doc | note | unknown
  title       text        not null,           -- AI-generated short title
  body        text        not null default '', -- AI-structured content
  created_at  timestamptz not null default now()
);

create index if not exists items_created_at_idx on items (created_at desc);
