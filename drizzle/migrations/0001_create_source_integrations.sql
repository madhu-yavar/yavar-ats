-- Non-secret integration configuration, readable by the HR team.
CREATE TABLE public.source_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_fields text[] NOT NULL DEFAULT '{}'::text[],
  has_credentials boolean NOT NULL DEFAULT false,
  last_test_status text NOT NULL DEFAULT 'untested',
  last_test_message text,
  last_tested_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_integrations TO authenticated;
GRANT ALL ON public.source_integrations TO service_role;

ALTER TABLE public.source_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read source_integrations" ON public.source_integrations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write source_integrations" ON public.source_integrations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update source_integrations" ON public.source_integrations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete source_integrations" ON public.source_integrations
  FOR DELETE TO authenticated USING (true);

-- Secret credentials: NO Data API access at all. Only reachable through
-- server-side privileged code (service role), never from the browser.
CREATE TABLE public.integration_credentials (
  integration_id uuid PRIMARY KEY REFERENCES public.source_integrations(id) ON DELETE CASCADE,
  secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.integration_credentials TO service_role;

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for anon/authenticated: credentials are server-only.

-- Provenance for candidates imported from an external job board.
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_provider text;

CREATE UNIQUE INDEX IF NOT EXISTS candidates_external_unique
  ON public.candidates (external_provider, external_id)
  WHERE external_id IS NOT NULL;

-- Seed the provider catalogue so the settings page is configurable out of the box.
INSERT INTO public.source_integrations (provider, label, credential_fields, config) VALUES
  ('linkedin', 'LinkedIn Talent Solutions', ARRAY['client_id','client_secret'], '{"docs":"https://learn.microsoft.com/linkedin/talent/","notes":"Recruiter System Connect / Job Postings API. Candidate profiles cannot be read via the public API."}'::jsonb),
  ('naukri',   'Naukri Resdex / Recruiter API', ARRAY['client_id','client_secret','account_id'], '{"docs":"https://www.naukri.com/recruiter","notes":"Enterprise Resdex subscription required for resume search and applicant pulls."}'::jsonb),
  ('indeed',   'Indeed Apply + Job Feed', ARRAY['api_key','employer_id'], '{"docs":"https://docs.indeed.com/","notes":"Job XML feed plus Indeed Apply webhook for applicants."}'::jsonb),
  ('github',   'GitHub Public API', ARRAY['token'], '{"docs":"https://docs.github.com/rest","notes":"Token is optional; it raises the rate limit from 60 to 5000 requests/hour."}'::jsonb),
  ('careers',  'Careers page / email applies', ARRAY[]::text[], '{"notes":"Always available. Candidates added manually or by resume paste."}'::jsonb)
ON CONFLICT (provider) DO NOTHING;

UPDATE public.source_integrations SET enabled = true, last_test_status = 'ok',
  last_test_message = 'Built-in source — no credentials required.'
  WHERE provider IN ('careers','github');
