-- Role-journey demo users for Demo Corp (applied after fixture.sql).
-- recruiter@demo.com (d003) / dh@demo.com (d004) / hm@demo.com (d005), password demo1234
insert into auth.users (id, email, email_confirmed_at) values
  ('6a6a0000-0000-4000-8000-00000000d003', 'recruiter@demo.com', now()),
  ('6a6a0000-0000-4000-8000-00000000d004', 'dh@demo.com', now()),
  ('6a6a0000-0000-4000-8000-00000000d005', 'hm@demo.com', now())
on conflict (id) do nothing;

insert into users (id, email, email_confirmed_at) values
  ('6a6a0000-0000-4000-8000-00000000d003', 'recruiter@demo.com', now()),
  ('6a6a0000-0000-4000-8000-00000000d004', 'dh@demo.com', now()),
  ('6a6a0000-0000-4000-8000-00000000d005', 'hm@demo.com', now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, email, status, is_owner, joined_at) values
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d003', 'recruiter@demo.com', 'active', false, now()),
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d004', 'dh@demo.com', 'active', false, now()),
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d005', 'hm@demo.com', 'active', false, now())
on conflict do nothing;

insert into user_roles (org_id, user_id, role) values
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d003', 'recruiter'),
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d004', 'department_head'),
  ('6a6a0000-0000-4000-8000-00000000d011', '6a6a0000-0000-4000-8000-00000000d005', 'hiring_manager')
on conflict do nothing;

-- Second organisation for org-to-org collaboration tests
insert into auth.users (id, email, email_confirmed_at) values
  ('6a6a0000-0000-4000-8000-00000000d006', 'owner@newdemo.com', now())
on conflict (id) do nothing;

insert into users (id, email, email_confirmed_at) values
  ('6a6a0000-0000-4000-8000-00000000d006', 'owner@newdemo.com', now())
on conflict (id) do nothing;

insert into organizations (id, name, slug, onboarding_step, onboarded_at, status, approved_at)
values ('6a6a0000-0000-4000-8000-00000000d013', 'New Demo Technologies', 'newdemo', 'done', now(), 'active', now())
on conflict (id) do nothing;

insert into org_members (org_id, user_id, email, status, is_owner, joined_at) values
  ('6a6a0000-0000-4000-8000-00000000d013', '6a6a0000-0000-4000-8000-00000000d006', 'owner@newdemo.com', 'active', true, now())
on conflict do nothing;

-- Give the seeded interview an assignee email so it lands in dh@demo.com's queue
update interviews set interviewer_email = 'dh@demo.com' where interviewer = 'Ananya Rao';
