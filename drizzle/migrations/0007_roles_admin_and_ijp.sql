-- Role administration (CHRO / president_cbo is the super-admin)
create policy "admins read all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'president_cbo'));
create policy "admins grant roles" on public.user_roles
  for insert to authenticated with check (public.has_role(auth.uid(), 'president_cbo'));
create policy "admins revoke roles" on public.user_roles
  for delete to authenticated using (public.has_role(auth.uid(), 'president_cbo'));

-- Internal job posting (IJP)
alter table public.requisitions add column if not exists ijp_enabled boolean not null default false;
alter table public.requisitions add column if not exists ijp_posted_at timestamptz;
alter table public.requisitions add column if not exists ijp_notes text;

alter table public.candidates add column if not exists is_internal boolean not null default false;
alter table public.candidates add column if not exists employee_id text;
alter table public.candidates add column if not exists current_department text;
alter table public.candidates add column if not exists manager_endorsed boolean not null default false;