-- 2026-10-07 — Per-user inbox privacy: candidate mail is owned by the
-- candidate's owning recruiter. HR leadership (owner / hr_head /
-- president_cbo) sees everything; every other member sees only mail on their
-- own candidates.
-- Idempotent: re-running is a no-op.
alter table inbox_messages add column if not exists owner_id uuid;
create index if not exists inbox_messages_owner_idx on inbox_messages (org_id, owner_id, received_at);
