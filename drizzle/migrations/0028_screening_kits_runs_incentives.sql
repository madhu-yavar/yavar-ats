-- Preliminary screening support: question kits per candidate+role, graded answer runs,
-- and the CHRO's incentive scheme used to compute recruiter payouts.

CREATE TABLE public.screening_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  focus_summary text,
  engine jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX screening_kits_candidate_idx ON public.screening_kits (candidate_id, created_at DESC);
CREATE INDEX screening_kits_org_idx ON public.screening_kits (org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.screening_kits TO authenticated;
GRANT ALL ON public.screening_kits TO service_role;
ALTER TABLE public.screening_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "screening_kits_select" ON public.screening_kits FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_kits_insert" ON public.screening_kits FOR INSERT TO authenticated
  WITH CHECK (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_kits_update" ON public.screening_kits FOR UPDATE TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_kits_delete" ON public.screening_kits FOR DELETE TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));

CREATE TRIGGER screening_kits_fill_org BEFORE INSERT ON public.screening_kits
  FOR EACH ROW EXECUTE FUNCTION public.fill_org_from_parent('candidates', 'candidate_id');

CREATE TABLE public.screening_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  kit_id uuid NOT NULL REFERENCES public.screening_kits(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  input_kind text NOT NULL DEFAULT 'typed',
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript text,
  audio_path text,
  audio_engine text,
  screening_score integer NOT NULL DEFAULT 0,
  match_score integer,
  combined_score integer,
  verdicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flags text[] NOT NULL DEFAULT '{}',
  rationale text,
  recommendation text,
  recommendation_reason text,
  engine jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX screening_runs_kit_idx ON public.screening_runs (kit_id, created_at DESC);
CREATE INDEX screening_runs_candidate_idx ON public.screening_runs (candidate_id, created_at DESC);
CREATE INDEX screening_runs_org_created_idx ON public.screening_runs (org_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.screening_runs TO authenticated;
GRANT ALL ON public.screening_runs TO service_role;
ALTER TABLE public.screening_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "screening_runs_select" ON public.screening_runs FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_runs_insert" ON public.screening_runs FOR INSERT TO authenticated
  WITH CHECK (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_runs_update" ON public.screening_runs FOR UPDATE TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "screening_runs_delete" ON public.screening_runs FOR DELETE TO authenticated
  USING (org_id IS NULL OR public.is_org_member(org_id));

CREATE TRIGGER screening_runs_fill_org BEFORE INSERT ON public.screening_runs
  FOR EACH ROW EXECUTE FUNCTION public.fill_org_from_parent('candidates', 'candidate_id');

CREATE TABLE public.hr_incentive_schemes (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'INR',
  target_closures_per_month integer NOT NULL DEFAULT 3,
  payout_per_closure numeric NOT NULL DEFAULT 10000,
  quality_bands jsonb NOT NULL DEFAULT '[{"min_score":85,"multiplier":1.2},{"min_score":70,"multiplier":1},{"min_score":0,"multiplier":0.8}]'::jsonb,
  monthly_cap numeric,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_incentive_schemes TO authenticated;
GRANT ALL ON public.hr_incentive_schemes TO service_role;
ALTER TABLE public.hr_incentive_schemes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_incentive_select" ON public.hr_incentive_schemes FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "hr_incentive_insert" ON public.hr_incentive_schemes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_owner(org_id)
    OR public.has_org_role(auth.uid(), org_id, 'president_cbo')
    OR public.has_org_role(auth.uid(), org_id, 'hr_head')
  );
CREATE POLICY "hr_incentive_update" ON public.hr_incentive_schemes FOR UPDATE TO authenticated
  USING (
    public.is_org_owner(org_id)
    OR public.has_org_role(auth.uid(), org_id, 'president_cbo')
    OR public.has_org_role(auth.uid(), org_id, 'hr_head')
  );
CREATE POLICY "hr_incentive_delete" ON public.hr_incentive_schemes FOR DELETE TO authenticated
  USING (public.is_org_owner(org_id));