alter table public.organizations add column if not exists inbox_slug text;

update public.organizations
set inbox_slug = regexp_replace(lower(coalesce(slug, id::text)), '[^a-z0-9-]+', '-', 'g')
where inbox_slug is null;

create unique index if not exists organizations_inbox_slug_key
  on public.organizations (lower(inbox_slug)) where inbox_slug is not null;

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  to_address text,
  from_email text,
  from_name text,
  subject text,
  body text,
  attachment_name text,
  attachment_bytes integer,
  status text not null default 'received',
  detail text,
  candidate_id uuid,
  requisition_id uuid,
  provider_message_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists inbox_messages_org_idx on public.inbox_messages (org_id, received_at desc);
create unique index if not exists inbox_messages_provider_key
  on public.inbox_messages (org_id, provider_message_id) where provider_message_id is not null;

grant select, delete on public.inbox_messages to authenticated;
grant all on public.inbox_messages to service_role;

alter table public.inbox_messages enable row level security;

drop policy if exists "org read inbox" on public.inbox_messages;
create policy "org read inbox" on public.inbox_messages
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists "org delete inbox" on public.inbox_messages;
create policy "org delete inbox" on public.inbox_messages
  for delete to authenticated using (public.is_org_member(org_id));