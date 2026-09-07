ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS careers_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_careers_email_key
  ON public.organizations (lower(careers_email))
  WHERE careers_email IS NOT NULL;