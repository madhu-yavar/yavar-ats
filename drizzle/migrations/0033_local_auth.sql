CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  email_confirmed_at timestamptz,
  password_hash text,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_login_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON public.users (lower(email));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_used_at timestamptz DEFAULT now() NOT NULL,
  user_agent text,
  ip text
);

GRANT ALL ON public.sessions TO service_role;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON public.sessions (user_id);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT auth_tokens_purpose_check CHECK (purpose IN ('confirm', 'reset'))
);

GRANT ALL ON public.auth_tokens TO service_role;
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON public.auth_tokens (user_id, purpose);
ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  ip text,
  success boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

GRANT ALL ON public.login_attempts TO service_role;
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON public.login_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON public.login_attempts (ip, created_at);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    INSERT INTO public.users (id, email, email_confirmed_at, password_hash, full_name, created_at)
    SELECT au.id, au.email, au.email_confirmed_at, au.encrypted_password,
           au.raw_user_meta_data ->> 'full_name', au.created_at
    FROM auth.users au
    WHERE au.email IS NOT NULL
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;