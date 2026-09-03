-- Organisation lifecycle: archive instead of destructive delete.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text;

-- Platform (product owner) super-user allowlist, keyed by email address.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  user_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins can read the allowlist"
ON public.platform_admins
FOR SELECT
TO authenticated
USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

CREATE INDEX IF NOT EXISTS platform_admins_email_idx ON public.platform_admins (lower(email));