CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  actor_user_id uuid,
  actor text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb,
  ip text,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_tokens TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_attempts TO authenticated, anon;
GRANT SELECT, INSERT ON public.audit_log TO authenticated, anon;
GRANT ALL ON public.audit_log TO service_role;