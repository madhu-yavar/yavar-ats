CREATE TABLE public.product_catalogue_commercials (
  module_id text PRIMARY KEY,
  tier text,
  list_price numeric,
  currency text NOT NULL DEFAULT 'USD',
  unit text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Product-owner data only: reached exclusively through super-user server functions.
GRANT ALL ON public.product_catalogue_commercials TO service_role;
ALTER TABLE public.product_catalogue_commercials ENABLE ROW LEVEL SECURITY;