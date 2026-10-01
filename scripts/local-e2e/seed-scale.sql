-- seed-scale.sql — ~1000 candidates/applications against the local fixture DB,
-- so the screening triage queue is verified at the scale it was designed for.
--
--   psql -h 127.0.0.1 -p 54333 -U postgres -d atsiq_e2e \
--     -f scripts/local-e2e/seed-scale.sql
--
-- Deterministic (hashtext-derived) score spread, kits for ~40% of shortlisted
-- rows, graded runs for ~13%, and a handful of pending prep jobs so the
-- queue's pulse state is visible without any AI key. Every insert is guarded
-- (on conflict / where not exists), so re-running tops up harmlessly.

-- ---------------------------------------------------------------- roles ----
insert into requisitions (id, org_id, code, title, status, location, openings,
                          experience_min, experience_max, must_have_skills, good_to_have_skills)
values
  ('6a6a0000-0000-4000-8000-000000009001', '6a6a0000-0000-4000-8000-00000000d012',
   'SCALE-A', 'Scale Role A', 'approved', 'Bengaluru', 3, 2, 6,
   array['postgresql','typescript'], array['kubernetes']),
  ('6a6a0000-0000-4000-8000-000000009002', '6a6a0000-0000-4000-8000-00000000d012',
   'SCALE-B', 'Scale Role B', 'approved', 'Pune', 2, 3, 8,
   array['go','kafka'], array['grpc'])
on conflict (id) do nothing;

-- ------------------------------------------------------------ candidates ----
insert into candidates (id, org_id, full_name, email, source, experience_years, location, skills)
select
  ('6a6a0000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  '6a6a0000-0000-4000-8000-00000000d012',
  'Scale Candidate ' || g,
  'scale-' || g || '@example.test',
  (array['direct','linkedin','naukri','indeed'])[1 + g % 4],
  (g % 15),
  (array['Bengaluru','Pune','Hyderabad','Remote'])[1 + g % 4],
  array['postgresql','kubernetes','typescript']
from generate_series(1, 1000) g
on conflict (id) do nothing;

-- ---------------------------------------------------------- applications ----
insert into applications (id, org_id, requisition_id, candidate_id, stage, source, applied_at)
select
  ('7a7a0000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  '6a6a0000-0000-4000-8000-00000000d012',
  case when g % 2 = 0 then '6a6a0000-0000-4000-8000-000000009001'::uuid
       else '6a6a0000-0000-4000-8000-000000009002'::uuid end,
  ('6a6a0000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  -- majority shortlisted; the rest spread across funnel + terminal stages
  (array['shortlisted','shortlisted','shortlisted','shortlisted','shortlisted',
         'shortlisted','shortlisted','applied','ai_screened','sourced',
         'l1','l2','l3','offer_pending','rejected','joined'])[1 + g % 16]::app_stage,
  'direct',
  now() - ((g % 720) || ' hours')::interval
from generate_series(1, 1000) g
on conflict do nothing;

-- ---------------------------------------------------------- match scores ----
insert into match_scores (application_id, org_id, overall_score, skills_score,
                          experience_score, matched_skills, missing_skills,
                          rationale, recommendation, computed_at)
select a.id, a.org_id,
       abs(hashtext(a.id::text)) % 100,
       abs(hashtext(a.id::text)) % 100,
       (abs(hashtext(a.id::text)) / 3) % 100,
       array['postgresql'], array['kubernetes'],
       'Seeded for scale verification.',
       (array['select','hold','reject'])[1 + abs(hashtext(a.id::text)) % 3]::recommendation,
       now() - ((abs(hashtext(a.id::text)) % 720) || ' minutes')::interval
from applications a
where a.org_id = '6a6a0000-0000-4000-8000-00000000d012'
  and a.stage = 'shortlisted'
  and not exists (select 1 from match_scores m where m.application_id = a.id);

-- ------------------------------------------------------------------ kits ----
insert into screening_kits (id, org_id, candidate_id, requisition_id, application_id,
                            questions, focus_summary, engine, created_at)
select
  ('8b8b0000-0000-4000-8000-' || lpad(to_hex(split_part(split_part(c.email, '-', 2), '@', 1)::int), 12, '0'))::uuid,
  a.org_id, a.candidate_id, a.requisition_id, a.id,
  '[{"id":"q1","focus":"experience_depth","question":"Seeded screening question — walk me through your last production incident.","reason":"Seeded","expected_answer":"A concrete, owned narrative.","weak_answer":"Vague deflection.","weight":4}]'::jsonb,
  'Seeded kit for scale verification.',
  '{}'::jsonb,
  a.applied_at
from applications a
join candidates c on c.id = a.candidate_id
where a.org_id = '6a6a0000-0000-4000-8000-00000000d012'
  and a.stage = 'shortlisted'
  and c.email like 'scale-%@example.test'
  and hashtext(c.id::text) % 5 < 2          -- ~40%
  and not exists (
    select 1 from screening_kits k
    where k.candidate_id = a.candidate_id and k.requisition_id = a.requisition_id);

-- ------------------------------------------------------------------ runs ----
insert into screening_runs (id, org_id, kit_id, candidate_id, requisition_id, application_id,
                            input_kind, screening_score, match_score, combined_score,
                            verdicts, red_flags, rationale, recommendation, created_at)
select
  ('9c9c0000-0000-4000-8000-' || lpad(to_hex(split_part(split_part(c.email, '-', 2), '@', 1)::int), 12, '0'))::uuid,
  k.org_id, k.id, k.candidate_id, k.requisition_id, k.application_id,
  'typed',
  40 + abs(hashtext(k.id::text)) % 60,
  m.overall_score,
  round((m.overall_score * 0.6 + (40 + abs(hashtext(k.id::text)) % 60) * 0.4))::int,
  '[]'::jsonb,
  case when abs(hashtext(k.id::text)) % 5 = 0
       then array['Seeded flag: tenure gap 2023–24'] else array[]::text[] end,
  'Seeded run for scale verification.',
  (array['advance','hold','reject'])[1 + abs(hashtext(k.id::text)) % 3],
  now() - ((abs(hashtext(k.id::text)) % 48) || ' hours')::interval
from screening_kits k
join applications a on a.id = k.application_id
join candidates c on c.id = k.candidate_id
left join lateral (
  select ms.overall_score from match_scores ms
  where ms.application_id = a.id order by ms.computed_at desc limit 1
) m on true
where k.org_id = '6a6a0000-0000-4000-8000-00000000d012'
  and k.candidate_id::text like '6a6a0000-0000-4000-8000-0000000%'
  and hashtext(k.id::text) % 3 = 0          -- ~13% of kits
  and not exists (select 1 from screening_runs r where r.kit_id = k.id);

-- ------------------------------------------------------------- prep jobs ----
insert into screening_prep_jobs (org_id, application_id, candidate_id, requisition_id, status)
select a.org_id, a.id, a.candidate_id, a.requisition_id, 'pending'
from applications a
join candidates c on c.id = a.candidate_id
where a.org_id = '6a6a0000-0000-4000-8000-00000000d012'
  and a.stage = 'shortlisted'
  and c.email like 'scale-%@example.test'
  and not exists (select 1 from screening_kits k
                  where k.candidate_id = a.candidate_id
                    and k.requisition_id = a.requisition_id)
  and not exists (select 1 from screening_prep_jobs j where j.application_id = a.id)
limit 10;
