-- 0023_observability.sql — structured log pipeline + AI prompt/response traces.
--
-- app_logs: every API/server-fn request, every console.error/warn, every email
--   send attempt and every client-side error lands here. Queryable from the
--   superadmin observability console. Purged after 14 days (in the logger).
-- ai_traces: full system/prompt/response capture per AI gateway invocation,
--   including per-attempt frames and the schema-validation verdict. Contains
--   CV/JD text — superadmin console only. Purged after 14 days.
-- ai_usage_events.trace_id: nullable link from a ledger row to its trace.
--
-- No FKs from logs/traces to organizations/users: observability rows must
-- survive entity deletion and never cascade-delete.
--
-- Idempotent: re-running is a no-op.

create table if not exists app_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null, -- debug | info | warn | error
  source text not null, -- http | server-fn | client | email | ai | cron | auth | job | app
  message text not null,
  detail jsonb,
  org_id uuid,
  user_id uuid,
  route text,
  status_code integer,
  duration_ms integer,
  created_at timestamptz not null default now()
);

drop index if exists app_logs_created_idx;
create index if not exists app_logs_created_idx on app_logs (created_at);

drop index if exists app_logs_level_created_idx;
create index if not exists app_logs_level_created_idx on app_logs (level, created_at);

drop index if exists app_logs_source_created_idx;
create index if not exists app_logs_source_created_idx on app_logs (source, created_at);

drop index if exists app_logs_org_created_idx;
create index if not exists app_logs_org_created_idx on app_logs (org_id, created_at);

create table if not exists ai_traces (
  id uuid primary key, -- the gateway generates it; ai_usage_events.trace_id links here
  org_id uuid,
  user_id uuid,
  feature text not null,
  ok boolean not null,
  schema_valid boolean,
  attempts integer not null default 1,
  duration_ms integer,
  grounded boolean,
  error_message text,
  system_prompt text,
  prompt text,
  response text,
  usage_frames jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

drop index if exists ai_traces_created_idx;
create index if not exists ai_traces_created_idx on ai_traces (created_at);

drop index if exists ai_traces_org_created_idx;
create index if not exists ai_traces_org_created_idx on ai_traces (org_id, created_at);

drop index if exists ai_traces_feature_created_idx;
create index if not exists ai_traces_feature_created_idx on ai_traces (feature, created_at);

alter table ai_usage_events add column if not exists trace_id uuid;

drop index if exists ai_usage_events_trace_idx;
create index if not exists ai_usage_events_trace_idx on ai_usage_events (trace_id);
