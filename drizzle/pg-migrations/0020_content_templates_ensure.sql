-- content_templates: ensure the table matches drizzle/schema.ts on stacks
-- that skipped pg-migrations 0002–0005. Fixture-built local clusters load a
-- dump that predates the table entirely, so saving a template failed with a
-- raw "Failed query: insert into content_templates…" toast. Production ran
-- 0002–0005 in order, so every statement here is a no-op there.
CREATE TABLE IF NOT EXISTS public.content_templates (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "instructions" text,
  "logo_path" text,
  "logo_content_type" text,
  "background_path" text,
  "background_content_type" text,
  "source_path" text,
  "source_name" text,
  "source_content_type" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- A table inherited from 0002 carries the older 3-kind check; widen it to
-- today's kinds. No-op when the constraint is absent or already current.
DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
    FROM pg_constraint WHERE conname = 'content_templates_kind_check';
  IF current_def IS NULL THEN
    ALTER TABLE public.content_templates ADD CONSTRAINT content_templates_kind_check
      CHECK (kind in ('linkedin_post', 'jd', 'job_card', 'offer_letter'));
  ELSIF current_def NOT LIKE '%offer_letter%' THEN
    ALTER TABLE public.content_templates DROP CONSTRAINT content_templates_kind_check;
    ALTER TABLE public.content_templates ADD CONSTRAINT content_templates_kind_check
      CHECK (kind in ('linkedin_post', 'jd', 'job_card', 'offer_letter'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS content_templates_org_kind_name_key
  ON public.content_templates (org_id, kind, name);
CREATE UNIQUE INDEX IF NOT EXISTS content_templates_org_kind_default_key
  ON public.content_templates (org_id, kind) WHERE is_default;
