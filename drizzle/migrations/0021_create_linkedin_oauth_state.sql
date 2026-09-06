-- One-time-connect OAuth handshake state for the company LinkedIn account.
-- Rows are created when a recruiter presses "Connect LinkedIn account" and are
-- consumed (single-use) by the /api/auth/linkedin/callback route. RLS is on
-- with no policies: only the service-role server code touches this table.
create table public.linkedin_oauth_states (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);

alter table public.linkedin_oauth_states enable row level security;

create index if not exists linkedin_oauth_states_expires_at_idx on public.linkedin_oauth_states (expires_at);
