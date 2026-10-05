-- 0024_trace_steps.sql — agent-loop spans under an AI trace, harness metadata.
--
-- ai_trace_steps: one row per step of an AI invocation — model_call, tool_call
--   (e.g. the research path's web searches) or guard. Ordered by seq within a
--   trace; payloads size-capped by the gateway. Cascades on trace delete so
--   the 14-day purge in src/server/logger.ts sweeps spans for free.
-- ai_traces.harness: 'json' (structured single call) | 'research' (grounded).
-- ai_traces.capability: coarse grouping of the feature slug (screening,
--   matching, jd, research, comms, copilot, platform) for the console views.
--
-- Idempotent: re-running is a no-op.

create table if not exists ai_trace_steps (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references ai_traces (id) on delete cascade,
  seq integer not null,
  kind text not null, -- model_call | tool_call | guard
  name text not null,
  status text not null default 'ok', -- ok | error | running
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now()
);

drop index if exists ai_trace_steps_trace_seq_idx;
create index if not exists ai_trace_steps_trace_seq_idx on ai_trace_steps (trace_id, seq);

alter table ai_traces add column if not exists harness text;
alter table ai_traces add column if not exists capability text;

create index if not exists ai_traces_capability_idx on ai_traces (capability);
