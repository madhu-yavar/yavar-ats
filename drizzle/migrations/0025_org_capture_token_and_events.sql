alter table public.organizations add column if not exists capture_token text;

update public.organizations
set capture_token = encode(gen_random_bytes(24), 'hex')
where capture_token is null;

create unique index if not exists organizations_capture_token_key
  on public.organizations (capture_token);

create table if not exists public.capture_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  source_url text,
  title text,
  status text not null default 'stored',
  detail text,
  candidate_id uuid references public.candidates(id) on delete set null,
  requisition_id uuid references public.requisitions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists capture_events_org_created_idx
  on public.capture_events (org_id, created_at desc);

grant select on public.capture_events to authenticated;
grant all on public.capture_events to service_role;

alter table public.capture_events enable row level security;

create policy "org read captures" on public.capture_events
  for select to authenticated using (public.is_org_member(org_id));
