CREATE TABLE IF NOT EXISTS public.comp_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  role_key text NOT NULL,
  title text NOT NULL,
  location text,
  level_key text NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  low numeric,
  median numeric NOT NULL,
  high numeric,
  experience_min integer,
  experience_max integer,
  source text NOT NULL DEFAULT 'user_override',
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.comp_knowledge TO service_role;

ALTER TABLE public.comp_knowledge ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS comp_knowledge_org_role_idx ON public.comp_knowledge (org_id, role_key, created_at);
CREATE INDEX IF NOT EXISTS comp_knowledge_org_created_idx ON public.comp_knowledge (org_id, created_at);