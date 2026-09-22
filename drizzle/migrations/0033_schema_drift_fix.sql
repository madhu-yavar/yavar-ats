ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS suspected_prompt_injection boolean NOT NULL DEFAULT false;
ALTER TABLE public.job_descriptions ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE public.job_descriptions ADD COLUMN IF NOT EXISTS template_name text;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS letter jsonb;
ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS letter_template_id uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS capture_token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_capture_token_hash_key ON public.organizations (capture_token_hash);
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS career_level text;
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS job_card_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.salary_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  input_key text NOT NULL,
  title text NOT NULL,
  location text,
  experience_min integer NOT NULL DEFAULT 0,
  experience_max integer NOT NULL DEFAULT 5,
  currency text NOT NULL DEFAULT 'INR',
  grounded boolean NOT NULL DEFAULT false,
  confidence text NOT NULL DEFAULT 'medium',
  payload jsonb NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_benchmarks_org_input_idx ON public.salary_benchmarks (org_id, input_key, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_benchmarks TO authenticated;
GRANT ALL ON public.salary_benchmarks TO service_role;
ALTER TABLE public.salary_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  instructions text,
  logo_path text,
  logo_content_type text,
  background_path text,
  background_content_type text,
  source_path text,
  source_name text,
  source_content_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_templates_kind_check CHECK (kind in ('linkedin_post','jd','job_card','offer_letter'))
);
CREATE UNIQUE INDEX IF NOT EXISTS content_templates_org_kind_name_key ON public.content_templates (org_id, kind, name);
CREATE UNIQUE INDEX IF NOT EXISTS content_templates_org_kind_default_key ON public.content_templates (org_id, kind) WHERE is_default;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_templates TO authenticated;
GRANT ALL ON public.content_templates TO service_role;
ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO sandbox_exec;
GRANT ALL ON ALL TABLES IN SCHEMA public TO sandbox_exec;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sandbox_exec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sandbox_exec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sandbox_exec;