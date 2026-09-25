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

-- First-party login (self-hosting cut) verifies scrypt hashes in
-- users.password_hash. The fixture predates first-party auth: it leaves the
-- hash null and its e2e-mirror rows squat on the d001/d002 primary keys, so
-- the real accounts get surrogate ids (e201/e202 — e201 matches preon-seed in
-- /tmp/atsiq-e2e). Shared password: demo1234.
-- Hash: scrypt via src/server/password.ts hashPassword("demo1234")
insert into users (id, email, email_confirmed_at, password_hash) values
  ('a0000000-0000-4000-8000-00000000e201', 'madhu@demo.com', now(),
   'scrypt$16384$8$1$XdqR7jzwilBTu0rR2a7MVg$rGF6w7ClW3hSVcRrCJGvMA3-RLXsYoc0-JmrQdKbT1KyC01edbspjueeCs9oFkQ7WkHaNQgk2fEzjPiGJjzveA'),
  ('a0000000-0000-4000-8000-00000000e202', 'hr@yavar.ai', now(),
   'scrypt$16384$8$1$XdqR7jzwilBTu0rR2a7MVg$rGF6w7ClW3hSVcRrCJGvMA3-RLXsYoc0-JmrQdKbT1KyC01edbspjueeCs9oFkQ7WkHaNQgk2fEzjPiGJjzveA')
-- conflict on email: login resolves by email, and other e2e seeds may have
-- created the account under a different surrogate id
on conflict (email) do update set password_hash = excluded.password_hash,
                                  email_confirmed_at = now();

-- the fixture's org_members rows point at the squatted d001/d002 ids; repoint
-- them at the surrogate ids (madhu's is also done by preon-seed)
update org_members set user_id = 'a0000000-0000-4000-8000-00000000e201', status = 'active', is_owner = true
where org_id = '6a6a0000-0000-4000-8000-00000000d011' and lower(email) = 'madhu@demo.com';
update org_members set user_id = 'a0000000-0000-4000-8000-00000000e202', status = 'active', is_owner = true
where org_id = '6a6a0000-0000-4000-8000-00000000d012' and lower(email) = 'hr@yavar.ai';

update users set password_hash =
  'scrypt$16384$8$1$XdqR7jzwilBTu0rR2a7MVg$rGF6w7ClW3hSVcRrCJGvMA3-RLXsYoc0-JmrQdKbT1KyC01edbspjueeCs9oFkQ7WkHaNQgk2fEzjPiGJjzveA'
where email in ('recruiter@demo.com', 'dh@demo.com', 'hm@demo.com', 'owner@newdemo.com')
  and (password_hash is null or password_hash = '');
