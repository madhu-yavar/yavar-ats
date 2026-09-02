ALTER TABLE public.master_items DROP CONSTRAINT IF EXISTS master_items_kind_check;
ALTER TABLE public.master_items ADD CONSTRAINT master_items_kind_check
  CHECK (kind IN ('skill','location','education','employment_type','industry','role_title','billing_type','engagement_type','client'));