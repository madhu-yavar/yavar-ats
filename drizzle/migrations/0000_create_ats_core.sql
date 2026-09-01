-- ENUMS
create type public.req_type as enum ('new','replacement');
create type public.req_status as enum ('draft','pending_dh','pending_hr','pending_cbo','approved','rejected','on_hold','closed');
create type public.jd_status as enum ('draft','pending_dh','approved','changes_requested');
create type public.app_stage as enum ('applied','ai_screened','shortlisted','l1','l2','l3','offer','hired','rejected');
create type public.recommendation as enum ('select','reject','hold');
create type public.offer_status as enum ('draft','pending_hr','pending_cbo','approved','released','accepted','declined','revoked');
create type public.app_role as enum ('recruiter','hiring_manager','department_head','hr_head','president_cbo');

-- ROLES
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles readable" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- DEPARTMENTS / BUDGET
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  head_name text,
  budgeted_headcount int not null default 0,
  budgeted_cost numeric(14,2) not null default 0,
  period text not null default 'FY26',
  created_at timestamptz not null default now()
);

-- REQUISITIONS
create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  department_id uuid references public.departments(id) on delete set null,
  req_type req_type not null default 'new',
  status req_status not null default 'draft',
  location text,
  openings int not null default 1,
  experience_min int not null default 0,
  experience_max int not null default 5,
  budget_ctc numeric(14,2) not null default 0,
  hiring_manager text,
  must_have_skills text[] not null default '{}',
  good_to_have_skills text[] not null default '{}',
  responsibilities text,
  education_requirement text,
  weight_skills int not null default 50,
  weight_experience int not null default 25,
  weight_education int not null default 10,
  weight_social int not null default 15,
  approval_trail jsonb not null default '[]'::jsonb,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- JOB DESCRIPTIONS
create table public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  version int not null default 1,
  status jd_status not null default 'draft',
  purpose text,
  responsibilities text,
  must_have text[] not null default '{}',
  good_to_have text[] not null default '{}',
  qualifications text,
  success_factors text,
  reporting_to text,
  full_text text,
  approver_comment text,
  created_at timestamptz not null default now()
);

-- CANDIDATES
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  location text,
  source text not null default 'direct',
  experience_years numeric(4,1) not null default 0,
  current_ctc numeric(14,2),
  expected_ctc numeric(14,2),
  notice_period_days int,
  education text,
  skills text[] not null default '{}',
  resume_text text,
  linkedin_url text,
  github_url text,
  website_url text,
  x_url text,
  consent_given boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.candidates using gin (skills);

-- APPLICATIONS
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  stage app_stage not null default 'applied',
  source text not null default 'direct',
  applied_at timestamptz not null default now(),
  unique (requisition_id, candidate_id)
);

-- MATCH SCORES (JD vs CV)
create table public.match_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  skills_score int not null default 0,
  experience_score int not null default 0,
  education_score int not null default 0,
  social_score int not null default 0,
  overall_score int not null default 0,
  weights jsonb not null default '{"skills":50,"experience":25,"education":10,"social":15}'::jsonb,
  matched_skills text[] not null default '{}',
  missing_skills text[] not null default '{}',
  rationale text,
  risk_flags text[] not null default '{}',
  recommendation recommendation,
  model text,
  recruiter_override recommendation,
  override_reason text,
  computed_at timestamptz not null default now()
);
create index on public.match_scores (application_id);

-- SOCIAL PROFILES
create table public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  provider text not null,
  profile_url text,
  handle text,
  score int not null default 0,
  signals jsonb not null default '{}'::jsonb,
  rationale text,
  raw jsonb,
  status text not null default 'ok',
  fetched_at timestamptz not null default now(),
  unique (candidate_id, provider)
);

-- AI SCREENING INTERVIEW
create table public.ai_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  jd_match_score int not null default 0,
  skillset_score int not null default 0,
  culture_role_score int not null default 0,
  culture_org_score int not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  created_at timestamptz not null default now()
);

-- INTERVIEWS + EVALUATIONS
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  level int not null default 1,
  interviewer text,
  scheduled_at timestamptz,
  teams_link text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  level int not null,
  evaluator text,
  focus_area text,
  rating int,
  comments text,
  recommendation recommendation not null default 'hold',
  created_at timestamptz not null default now()
);

-- OFFERS
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  offered_ctc numeric(14,2) not null default 0,
  joining_date date,
  status offer_status not null default 'draft',
  approval_trail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- GRANTS + RLS (internal workspace: any authenticated user of the tool)
do $$
declare t text;
begin
  foreach t in array array['departments','requisitions','job_descriptions','candidates','applications','match_scores','social_profiles','ai_interviews','interviews','evaluations','offers']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "authenticated read %1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "authenticated write %1$s" on public.%1$I for insert to authenticated with check (true)', t);
    execute format('create policy "authenticated update %1$s" on public.%1$I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "authenticated delete %1$s" on public.%1$I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- SEED DATA
insert into public.departments (id, name, head_name, budgeted_headcount, budgeted_cost) values
  ('11111111-1111-1111-1111-111111111111','Technology','Ananya Rao',24,96000000),
  ('22222222-2222-2222-2222-222222222222','Sales','Vikram Mehta',18,54000000),
  ('33333333-3333-3333-3333-333333333333','Finance','Rohit Nair',8,32000000);

insert into public.requisitions (id, code, title, department_id, req_type, status, location, openings, experience_min, experience_max, budget_ctc, hiring_manager, must_have_skills, good_to_have_skills, responsibilities, education_requirement) values
  ('aaaaaaa1-0000-0000-0000-000000000001','REQ-2026-001','Senior Backend Engineer','11111111-1111-1111-1111-111111111111','new','approved','Bengaluru',2,5,9,3800000,'Ananya Rao',
   '{"Python","PostgreSQL","AWS","System Design","Kubernetes"}','{"Go","Kafka","Terraform"}',
   'Own backend services end to end, design scalable APIs, mentor engineers, drive reliability and cost efficiency.','B.E./B.Tech in Computer Science or equivalent'),
  ('aaaaaaa1-0000-0000-0000-000000000002','REQ-2026-002','Enterprise Sales Manager','22222222-2222-2222-2222-222222222222','replacement','pending_hr','Mumbai',1,6,10,2900000,'Vikram Mehta',
   '{"Enterprise Sales","SaaS","Negotiation","CRM"}','{"BFSI Domain","Solution Selling"}',
   'Own the BFSI enterprise pipeline, lead RFP responses, close multi-year contracts.','MBA preferred'),
  ('aaaaaaa1-0000-0000-0000-000000000003','REQ-2026-003','Data Platform Lead','11111111-1111-1111-1111-111111111111','new','pending_dh','Hyderabad',1,8,12,4500000,'Ananya Rao',
   '{"Spark","Airflow","dbt","Snowflake","Data Modeling"}','{"Databricks","Streaming"}',
   'Build and lead the data platform team, own lakehouse architecture and governance.','B.Tech / M.Tech');

insert into public.job_descriptions (requisition_id, version, status, purpose, responsibilities, must_have, good_to_have, qualifications, success_factors, reporting_to, full_text) values
  ('aaaaaaa1-0000-0000-0000-000000000001',1,'approved',
   'Own the design and reliability of core backend platform services powering customer-facing products.',
   E'- Design and build scalable, secure APIs and services\n- Own service reliability, observability and on-call\n- Mentor mid-level engineers and raise code quality\n- Partner with product on technical scoping',
   '{"Python","PostgreSQL","AWS","System Design","Kubernetes"}','{"Go","Kafka","Terraform"}',
   'B.E./B.Tech in Computer Science with 5-9 years of backend experience',
   'Ships production services within first 90 days; reduces p95 latency; strong design review presence',
   'Engineering Manager, Technology',
   'Senior Backend Engineer — own the design and reliability of core backend platform services.');

insert into public.candidates (id, full_name, email, phone, location, source, experience_years, current_ctc, expected_ctc, notice_period_days, education, skills, linkedin_url, github_url, website_url, resume_text) values
  ('bbbbbbb1-0000-0000-0000-000000000001','Priya Sharma','priya.sharma@example.com','+91 98200 11223','Bengaluru','naukri',7,2900000,3600000,60,'B.Tech Computer Science, NIT Trichy',
   '{"Python","PostgreSQL","AWS","Kubernetes","System Design","Kafka"}','https://www.linkedin.com/in/priyasharma','https://github.com/torvalds','https://priyasharma.dev',
   'Senior backend engineer with 7 years across fintech and SaaS. Built payment ledger services in Python on AWS, migrated monolith to Kubernetes, owns PostgreSQL performance tuning and Kafka event pipelines. Led a team of 4.'),
  ('bbbbbbb1-0000-0000-0000-000000000002','Arjun Verma','arjun.verma@example.com','+91 99870 44531','Pune','linkedin',4,1600000,2400000,30,'B.E. Information Technology, Pune University',
   '{"Python","Django","MySQL","Docker"}','https://www.linkedin.com/in/arjunverma','https://github.com/gaearon',null,
   'Backend developer with 4 years building Django applications, MySQL schemas and Dockerised deployments for e-commerce clients. Limited cloud and distributed systems exposure.'),
  ('bbbbbbb1-0000-0000-0000-000000000003','Neha Iyer','neha.iyer@example.com','+91 90040 78219','Bengaluru','referral',9,3400000,4200000,90,'M.Tech Computer Science, IIT Bombay',
   '{"Go","Python","PostgreSQL","AWS","Kubernetes","Terraform","System Design"}','https://www.linkedin.com/in/nehaiyer','https://github.com/sindresorhus','https://nehaiyer.io',
   'Staff-level engineer, 9 years. Designed multi-region platform on AWS with Kubernetes and Terraform, authored internal system design guidelines, speaks at conferences, maintains two open-source Go libraries.');

insert into public.applications (id, requisition_id, candidate_id, stage, source) values
  ('ccccccc1-0000-0000-0000-000000000001','aaaaaaa1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000001','shortlisted','naukri'),
  ('ccccccc1-0000-0000-0000-000000000002','aaaaaaa1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000002','applied','linkedin'),
  ('ccccccc1-0000-0000-0000-000000000003','aaaaaaa1-0000-0000-0000-000000000001','bbbbbbb1-0000-0000-0000-000000000003','l1','referral');

insert into public.match_scores (application_id, skills_score, experience_score, education_score, social_score, overall_score, matched_skills, missing_skills, rationale, risk_flags, recommendation, model) values
  ('ccccccc1-0000-0000-0000-000000000001',88,90,85,72,86,'{"Python","PostgreSQL","AWS","Kubernetes","System Design"}','{}','Covers every must-have skill with depth in payments and platform work. Experience band sits inside the 5-9 year requirement. Social signal is solid but activity is inconsistent.','{"Expected CTC near budget ceiling"}','select','seed'),
  ('ccccccc1-0000-0000-0000-000000000002',52,45,78,48,53,'{"Python"}','{"PostgreSQL","AWS","Kubernetes","System Design"}','Strong Django delivery record but missing cloud, orchestration and distributed design must-haves. Experience is below the requisition band.','{"Below experience band","4 of 5 must-have skills missing"}','reject','seed'),
  ('ccccccc1-0000-0000-0000-000000000003',95,88,95,91,93,'{"Python","PostgreSQL","AWS","Kubernetes","System Design"}','{}','Exceeds every must-have plus both good-to-haves. Public engineering footprint is exceptional: maintained OSS libraries, conference talks and consistent contribution history.','{"Notice period 90 days"}','select','seed');

insert into public.social_profiles (candidate_id, provider, profile_url, handle, score, signals, rationale) values
  ('bbbbbbb1-0000-0000-0000-000000000001','github','https://github.com/torvalds','torvalds',74,'{"public_repos":8,"followers":210,"active_months_12":7,"top_languages":["Python","Go"]}','Consistent but bursty contribution pattern; repositories align with backend and infrastructure work.'),
  ('bbbbbbb1-0000-0000-0000-000000000001','linkedin','https://www.linkedin.com/in/priyasharma','priyasharma',70,'{"tenure_stability":"good","progression":"steady","headline_alignment":"high"}','Steady progression with 2.5 year average tenure and a headline that maps directly to the JD.'),
  ('bbbbbbb1-0000-0000-0000-000000000003','github','https://github.com/sindresorhus','sindresorhus',96,'{"public_repos":42,"followers":1800,"active_months_12":12,"top_languages":["Go","Python","TypeScript"]}','Sustained monthly contribution across 12 months, widely used OSS libraries, strong peer following.'),
  ('bbbbbbb1-0000-0000-0000-000000000003','linkedin','https://www.linkedin.com/in/nehaiyer','nehaiyer',88,'{"tenure_stability":"strong","progression":"fast","headline_alignment":"high"}','Fast progression to staff level with long tenures and public speaking record.'),
  ('bbbbbbb1-0000-0000-0000-000000000002','github','https://github.com/gaearon','gaearon',44,'{"public_repos":5,"followers":12,"active_months_12":2,"top_languages":["Python"]}','Sparse public activity; little evidence of infrastructure or scale work.');

insert into public.ai_interviews (application_id, jd_match_score, skillset_score, culture_role_score, culture_org_score, summary) values
  ('ccccccc1-0000-0000-0000-000000000001',86,88,82,79,'Clear articulation of ledger design trade-offs. Strong ownership signals. Slightly light on Kubernetes operational depth.'),
  ('ccccccc1-0000-0000-0000-000000000003',93,95,90,88,'Exceptional design reasoning and mentoring examples. Values map closely to engineering-led culture.');

insert into public.evaluations (application_id, level, evaluator, focus_area, rating, comments, recommendation) values
  ('ccccccc1-0000-0000-0000-000000000003',1,'Ananya Rao','Technical / functional competency',4,'Excellent system design depth, clean coding round.','select');

insert into public.interviews (application_id, level, interviewer, scheduled_at, teams_link, status) values
  ('ccccccc1-0000-0000-0000-000000000003',2,'Ananya Rao','2026-09-04 10:30:00+05:30','https://teams.microsoft.com/l/meetup-join/demo-l2','scheduled');