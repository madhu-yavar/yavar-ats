create table if not exists public.skill_nodes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  category text not null default 'general',
  aliases text[] not null default '{}',
  parent_slug text,
  supply integer not null default 0,
  demand integer not null default 0,
  validated integer not null default 0,
  evidence_count integer not null default 0,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.skill_edges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_slug text not null,
  to_slug text not null,
  kind text not null default 'cooccurs',
  weight numeric not null default 0,
  evidence_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, from_slug, to_slug, kind)
);

create table if not exists public.skill_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  candidate_id uuid references public.candidates(id) on delete cascade,
  requisition_id uuid references public.requisitions(id) on delete cascade,
  source text not null,
  strength numeric not null default 1,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.ontology_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  added text[] not null default '{}',
  grown text[] not null default '{}',
  dormant text[] not null default '{}',
  retired text[] not null default '{}',
  stats jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists skill_nodes_org_idx on public.skill_nodes (org_id, status);
create index if not exists skill_edges_org_idx on public.skill_edges (org_id, from_slug);
create index if not exists skill_evidence_org_slug_idx on public.skill_evidence (org_id, slug);
create index if not exists ontology_snapshots_org_idx on public.ontology_snapshots (org_id, created_at desc);

grant select, insert, update, delete on public.skill_nodes to authenticated;
grant select, insert, update, delete on public.skill_edges to authenticated;
grant select, insert, update, delete on public.skill_evidence to authenticated;
grant select, insert on public.ontology_snapshots to authenticated;
grant all on public.skill_nodes to service_role;
grant all on public.skill_edges to service_role;
grant all on public.skill_evidence to service_role;
grant all on public.ontology_snapshots to service_role;

alter table public.skill_nodes enable row level security;
alter table public.skill_edges enable row level security;
alter table public.skill_evidence enable row level security;
alter table public.ontology_snapshots enable row level security;

create policy "members read skill nodes" on public.skill_nodes
  for select to authenticated using (public.is_org_member(org_id));
create policy "members write skill nodes" on public.skill_nodes
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update skill nodes" on public.skill_nodes
  for update to authenticated using (public.is_org_member(org_id));
create policy "members delete skill nodes" on public.skill_nodes
  for delete to authenticated using (public.is_org_member(org_id));

create policy "members read skill edges" on public.skill_edges
  for select to authenticated using (public.is_org_member(org_id));
create policy "members write skill edges" on public.skill_edges
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update skill edges" on public.skill_edges
  for update to authenticated using (public.is_org_member(org_id));
create policy "members delete skill edges" on public.skill_edges
  for delete to authenticated using (public.is_org_member(org_id));

create policy "members read skill evidence" on public.skill_evidence
  for select to authenticated using (public.is_org_member(org_id));
create policy "members write skill evidence" on public.skill_evidence
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update skill evidence" on public.skill_evidence
  for update to authenticated using (public.is_org_member(org_id));
create policy "members delete skill evidence" on public.skill_evidence
  for delete to authenticated using (public.is_org_member(org_id));

create policy "members read ontology snapshots" on public.ontology_snapshots
  for select to authenticated using (public.is_org_member(org_id));
create policy "members write ontology snapshots" on public.ontology_snapshots
  for insert to authenticated with check (public.is_org_member(org_id));