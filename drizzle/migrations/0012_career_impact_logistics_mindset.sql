-- Career history, impact & innovation scoring, logistics risk, mindset assessments

ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS weight_career integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS weight_impact integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ctc_band_min numeric(14,2),
  ADD COLUMN IF NOT EXISTS ctc_band_max numeric(14,2),
  ADD COLUMN IF NOT EXISTS max_notice_period_days integer,
  ADD COLUMN IF NOT EXISTS work_authorization_required text;

-- New default split totals 100: skills 40 / experience 15 / career 10 / impact 10 / education 10 / social 15
ALTER TABLE public.requisitions ALTER COLUMN weight_skills SET DEFAULT 40;
ALTER TABLE public.requisitions ALTER COLUMN weight_experience SET DEFAULT 15;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS current_employer text,
  ADD COLUMN IF NOT EXISTS work_authorization text,
  ADD COLUMN IF NOT EXISTS willing_to_relocate boolean,
  ADD COLUMN IF NOT EXISTS preferred_locations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS referral_source text,
  ADD COLUMN IF NOT EXISTS employment_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS career_metrics jsonb;

ALTER TABLE public.match_scores
  ADD COLUMN IF NOT EXISTS career_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impact_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS innovation_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS career_metrics jsonb,
  ADD COLUMN IF NOT EXISTS career_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS logistics_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS impact_highlights text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS innovation_signals text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.candidate_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'sent',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  mindset_score integer,
  dimensions jsonb,
  red_flags text[] NOT NULL DEFAULT '{}',
  strengths text[] NOT NULL DEFAULT '{}',
  summary text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_assessments TO authenticated;
GRANT ALL ON public.candidate_assessments TO service_role;
ALTER TABLE public.candidate_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read assessments" ON public.candidate_assessments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert assessments" ON public.candidate_assessments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update assessments" ON public.candidate_assessments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete assessments" ON public.candidate_assessments FOR DELETE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS candidate_assessments_candidate_idx
  ON public.candidate_assessments(candidate_id, created_at DESC);
