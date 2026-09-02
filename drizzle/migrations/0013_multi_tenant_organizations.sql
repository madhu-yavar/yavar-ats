create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  legal_name text,
  industry text,
  hq_country text,
  hq_city text,
  employee_band text,
  currency text not null default 'INR',
  fiscal_year_start_month smallint not null default 4,
  careers_email text,
  onboarding_step text not null default 'profile',
  onboarded_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  email text not null,
  full_name text,
  title text,
  status text not null default 'invited',
  is_owner boolean not null default false,
  invited_by uuid,
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (org_id, email)
);
create unique index if not exists org_members_org_user_key
  on public.org_members (org_id, user_id) where user_id is not null;
create index if not exists org_members_user_idx on public.org_members (user_id);
create index if not exists org_members_email_idx on public.org_members (lower(email));

grant select, insert, update, delete on public.org_members to authenticated;
grant all on public.org_members to service_role;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_members
  where user_id = auth.uid() and status = 'active'
  order by created_at limit 1
$$;

create or replace function public.is_org_member(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = _org and user_id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.is_org_owner(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = _org and user_id = auth.uid() and status = 'active' and is_owner
  )
$$;

alter table public.organizations enable row level security;
drop policy if exists "members read own org" on public.organizations;
create policy "members read own org" on public.organizations
  for select to authenticated using (public.is_org_member(id));
drop policy if exists "anyone creates an org" on public.organizations;
create policy "anyone creates an org" on public.organizations
  for insert to authenticated with check (true);
drop policy if exists "owners update own org" on public.organizations;
create policy "owners update own org" on public.organizations
  for update to authenticated using (public.is_org_owner(id)) with check (public.is_org_owner(id));

alter table public.org_members enable row level security;
drop policy if exists "members read roster" on public.org_members;
create policy "members read roster" on public.org_members
  for select to authenticated
  using (public.is_org_member(org_id) or user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "owners invite" on public.org_members;
create policy "owners invite" on public.org_members
  for insert to authenticated
  with check (public.is_org_owner(org_id) or not exists (select 1 from public.org_members m where m.org_id = org_id));
drop policy if exists "owners or self update membership" on public.org_members;
create policy "owners or self update membership" on public.org_members
  for update to authenticated
  using (public.is_org_owner(org_id) or user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (true);
drop policy if exists "owners remove members" on public.org_members;
create policy "owners remove members" on public.org_members
  for delete to authenticated using (public.is_org_owner(org_id));

create or replace function public.fill_org_from_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  parent text := TG_ARGV[0];
  col text := TG_ARGV[1];
  parent_id uuid := (to_jsonb(new) ->> col)::uuid;
begin
  if new.org_id is null then
    if parent_id is not null then
      execute format('select org_id from public.%I where id = $1', parent) into v using parent_id;
    end if;
    new.org_id := coalesce(v, public.current_org_id());
  end if;
  return new;
end $$;

do $$
declare
  t text;
  root_tables text[] := array[
    'departments','candidates','requisitions','master_items','source_integrations',
    'ai_settings','ai_provider_credentials','user_roles'
  ];
  child text[][] := array[
    array['job_descriptions','requisitions','requisition_id'],
    array['applications','requisitions','requisition_id'],
    array['match_scores','applications','application_id'],
    array['interviews','applications','application_id'],
    array['evaluations','applications','application_id'],
    array['offers','applications','application_id'],
    array['stage_events','applications','application_id'],
    array['ai_interviews','applications','application_id'],
    array['candidate_assessments','candidates','candidate_id'],
    array['candidate_verifications','candidates','candidate_id'],
    array['social_profiles','candidates','candidate_id'],
    array['integration_credentials','source_integrations','integration_id']
  ];
  i int;
begin
  foreach t in array root_tables loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organizations(id) on delete cascade default public.current_org_id()', t);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_idx', t);
  end loop;

  for i in 1 .. array_length(child, 1) loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.organizations(id) on delete cascade', child[i][1]);
    execute format('create index if not exists %I on public.%I (org_id)', child[i][1] || '_org_idx', child[i][1]);
    execute format('drop trigger if exists %I on public.%I', child[i][1] || '_fill_org', child[i][1]);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.fill_org_from_parent(%L, %L)',
      child[i][1] || '_fill_org', child[i][1], child[i][2], child[i][3]
    );
  end loop;
end $$;

do $$
declare
  v_org uuid;
  t text;
  all_tables text[] := array[
    'departments','candidates','requisitions','master_items','source_integrations',
    'ai_settings','ai_provider_credentials','user_roles','job_descriptions','applications',
    'match_scores','interviews','evaluations','offers','stage_events','ai_interviews',
    'candidate_assessments','candidate_verifications','social_profiles','integration_credentials'
  ];
begin
  if exists (select 1 from public.organizations) then return; end if;
  if not exists (select 1 from auth.users) then return; end if;

  insert into public.organizations (name, slug, onboarding_step, onboarded_at)
  values ('My organisation', 'org-' || substr(md5(random()::text), 1, 8), 'done', now())
  returning id into v_org;

  insert into public.org_members (org_id, user_id, email, status, is_owner, joined_at)
  select v_org, u.id, coalesce(u.email, u.id::text), 'active',
         coalesce(public.has_role(u.id, 'president_cbo'), false), now()
  from auth.users u
  on conflict do nothing;

  if not exists (select 1 from public.org_members where org_id = v_org and is_owner) then
    update public.org_members set is_owner = true
    where id = (select id from public.org_members where org_id = v_org order by created_at limit 1);
  end if;

  foreach t in array all_tables loop
    execute format('update public.%I set org_id = %L where org_id is null', t, v_org);
  end loop;
end $$;

alter table public.departments drop constraint if exists departments_name_key;
create unique index if not exists departments_org_name_key on public.departments (org_id, name);

alter table public.requisitions drop constraint if exists requisitions_code_key;
create unique index if not exists requisitions_org_code_key on public.requisitions (org_id, code);

alter table public.source_integrations drop constraint if exists source_integrations_provider_key;
create unique index if not exists source_integrations_org_provider_key
  on public.source_integrations (org_id, provider);

alter table public.ai_settings drop constraint if exists ai_settings_singleton_unique;
create unique index if not exists ai_settings_org_key on public.ai_settings (org_id);

alter table public.ai_provider_credentials drop constraint if exists ai_provider_credentials_pkey;
create unique index if not exists ai_provider_credentials_org_provider_key
  on public.ai_provider_credentials (org_id, provider);

alter table public.user_roles drop constraint if exists user_roles_user_id_role_key;
create unique index if not exists user_roles_org_user_role_key on public.user_roles (org_id, user_id, role);

do $$
declare
  t text;
  p record;
  tables text[] := array[
    'departments','candidates','requisitions','master_items','source_integrations',
    'ai_settings','job_descriptions','applications','match_scores','interviews',
    'evaluations','offers','stage_events','ai_interviews','candidate_assessments',
    'candidate_verifications','social_profiles'
  ];
begin
  foreach t in array tables loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "org read %s" on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('create policy "org insert %s" on public.%I for insert to authenticated with check (org_id is null or public.is_org_member(org_id))', t, t);
    execute format('create policy "org update %s" on public.%I for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t, t);
    execute format('create policy "org delete %s" on public.%I for delete to authenticated using (public.is_org_member(org_id))', t, t);
  end loop;
end $$;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'user_roles' loop
    execute format('drop policy %I on public.user_roles', p.policyname);
  end loop;
end $$;

create policy "org read roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_org_member(org_id));
create policy "owners grant roles" on public.user_roles
  for insert to authenticated with check (public.is_org_owner(org_id) or org_id is null);
create policy "owners revoke roles" on public.user_roles
  for delete to authenticated using (public.is_org_owner(org_id));

create or replace function public.has_org_role(_user_id uuid, _org uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role and (org_id = _org or org_id is null)
  )
$$;