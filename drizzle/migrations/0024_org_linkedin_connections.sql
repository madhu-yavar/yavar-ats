CREATE TABLE public.org_linkedin_connections (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_sub TEXT NOT NULL,
  member_name TEXT,
  member_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  connected_by UUID,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tokens are server-only: no anon/authenticated grants at all. Status is read
-- through server functions using the service role.
GRANT ALL ON public.org_linkedin_connections TO service_role;

ALTER TABLE public.org_linkedin_connections ENABLE ROW LEVEL SECURITY;
