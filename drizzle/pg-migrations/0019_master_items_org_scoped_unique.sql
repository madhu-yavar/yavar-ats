-- Multi-tenant retrofit follow-up: master_items' (kind, lower(name)) uniqueness
-- shipped GLOBAL in the baseline and was never re-scoped here (only in the
-- retired drizzle/migrations chain, which production does not apply). Any
-- second tenant inserting a role title / skill / location named like another
-- tenant's entry hit a unique violation that the add path silently swallowed,
-- so the value never entered the tenant's library. Scope it per organisation,
-- matching drizzle/schema.ts. Rows with NULL org_id (seeded globals such as
-- rejection reasons) never conflict: Postgres treats NULL as distinct.
DROP INDEX IF EXISTS public.master_items_kind_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS master_items_kind_name_unique
  ON public.master_items (org_id, kind, lower(name));
