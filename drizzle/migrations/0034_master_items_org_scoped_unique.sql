-- Multi-tenant retrofit follow-up: master_items' (kind, lower(name)) uniqueness
-- was left GLOBAL when every other table was re-scoped to (org_id, …) in 0013.
-- Any second tenant inserting a location/department named like another tenant's
-- failed with a unique violation. Scope it per organisation.
DROP INDEX IF EXISTS public.master_items_kind_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS master_items_kind_name_unique
  ON public.master_items (org_id, kind, lower(name));
