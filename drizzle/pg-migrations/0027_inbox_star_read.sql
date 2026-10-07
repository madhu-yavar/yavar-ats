-- 2026-10-07 — Gmail-style inbox affordances: star + read state per mail.
-- Idempotent: re-running is a no-op.
alter table inbox_messages add column if not exists starred boolean not null default false;
alter table inbox_messages add column if not exists read_at timestamptz;
create index if not exists inbox_messages_starred_idx on inbox_messages (org_id, starred) where starred;
