-- Audit trail of every stage transition
CREATE TABLE IF NOT EXISTS public.stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_stage public.app_stage,
  to_stage public.app_stage NOT NULL,
  actor text,
  reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_events TO authenticated;
GRANT ALL ON public.stage_events TO service_role;
ALTER TABLE public.stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stage_events" ON public.stage_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert stage_events" ON public.stage_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update stage_events" ON public.stage_events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete stage_events" ON public.stage_events FOR DELETE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS stage_events_application_idx ON public.stage_events(application_id, created_at DESC);

-- Genuineness / claim verification results per candidate
CREATE TABLE IF NOT EXISTS public.candidate_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  authenticity_score integer NOT NULL DEFAULT 0,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flags text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  model text,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_verifications TO authenticated;
GRANT ALL ON public.candidate_verifications TO service_role;
ALTER TABLE public.candidate_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read verifications" ON public.candidate_verifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert verifications" ON public.candidate_verifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update verifications" ON public.candidate_verifications FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete verifications" ON public.candidate_verifications FOR DELETE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS candidate_verifications_candidate_idx
  ON public.candidate_verifications(candidate_id, created_at DESC);

-- Allow structured rejection reasons in the master library
ALTER TABLE public.master_items DROP CONSTRAINT IF EXISTS master_items_kind_check;
ALTER TABLE public.master_items ADD CONSTRAINT master_items_kind_check CHECK (kind = ANY (ARRAY[
  'skill','location','education','employment_type','industry','role_title',
  'billing_type','engagement_type','client','rejection_reason'
]));

INSERT INTO public.master_items (kind, name, sort_order)
SELECT 'rejection_reason', t.name, t.ord
FROM (VALUES
  ('Skills below requirement', 10),
  ('Experience mismatch', 20),
  ('Compensation expectations', 30),
  ('Notice period too long', 40),
  ('Communication / culture fit', 50),
  ('Failed technical evaluation', 60),
  ('Authenticity concerns', 70),
  ('Candidate withdrew', 80),
  ('Position closed / on hold', 90),
  ('Better candidate selected', 100)
) AS t(name, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_items m WHERE m.kind = 'rejection_reason' AND m.name = t.name
);
