ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Existing tenants stay approved; only new registrations enter the pending queue.
UPDATE public.organizations SET approved_at = COALESCE(approved_at, created_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS organizations_status_idx ON public.organizations (status);