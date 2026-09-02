ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'non_billable',
  ADD COLUMN IF NOT EXISTS engagement_type text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS cost_center text;