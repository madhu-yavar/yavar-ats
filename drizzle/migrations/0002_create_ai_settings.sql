CREATE TABLE public.ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  provider text NOT NULL DEFAULT 'lovable',
  model text NOT NULL DEFAULT 'google/gemini-3.7-flash',
  last_test_status text NOT NULL DEFAULT 'untested',
  last_test_message text,
  last_tested_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_settings_singleton_unique UNIQUE (singleton)
);

GRANT SELECT, INSERT, UPDATE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read ai_settings" ON public.ai_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write ai_settings" ON public.ai_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update ai_settings" ON public.ai_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.ai_provider_credentials (
  provider text PRIMARY KEY,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ai_provider_credentials TO service_role;

ALTER TABLE public.ai_provider_credentials ENABLE ROW LEVEL SECURITY;
