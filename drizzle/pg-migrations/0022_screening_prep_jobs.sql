-- 0022_screening_prep_jobs.sql — background screening-kit preparation queue.
--
-- One row per application (unique index); every shortlist upserts, so a failed
-- job re-enqueues with a clean slate. `status` is app-level text
-- (pending|running|ready|failed), matching email_outbox. `updated_at` doubles
-- as the claim lease and the retry-backoff clock (the worker reclaims rows
-- stuck in `running` for more than 10 minutes).
--
-- NO unique index is added on screening_kits: manual "Rebuild questions"
-- intentionally keeps multiple kits per pairing — dedupe happens in code.
--
-- Idempotent: re-running is a no-op.

create table if not exists screening_prep_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  candidate_id uuid not null references candidates (id) on delete cascade,
  requisition_id uuid not null references requisitions (id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists screening_prep_jobs_application_key;
create unique index if not exists screening_prep_jobs_application_key
  on screening_prep_jobs (application_id);

drop index if exists screening_prep_jobs_queue_idx;
create index if not exists screening_prep_jobs_queue_idx
  on screening_prep_jobs (status, updated_at);

drop index if exists screening_prep_jobs_org_idx;
create index if not exists screening_prep_jobs_org_idx
  on screening_prep_jobs (org_id, status);
