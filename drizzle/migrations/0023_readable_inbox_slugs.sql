-- Make each organisation's careers address readable: prefer the company's own
-- mail domain label (yavar.ai -> yavar), else the company name.
with base as (
  select id,
         coalesce(
           nullif(regexp_replace(split_part(coalesce(email_domain, ''), '.', 1), '[^a-z0-9-]+', '-', 'g'), ''),
           nullif(left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 28), ''),
           'org'
         ) as candidate
  from public.organizations
),
numbered as (
  select id, candidate,
         row_number() over (partition by candidate order by id) as rn
  from base
)
update public.organizations o
set inbox_slug = case when n.rn = 1 then n.candidate else n.candidate || '-' || n.rn end
from numbered n
where n.id = o.id
  and (o.inbox_slug is null or o.inbox_slug like 'org-%');