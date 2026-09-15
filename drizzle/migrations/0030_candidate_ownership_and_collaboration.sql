-- 1. Ownership on candidates (nullable: existing rows stay shared/unowned)
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS added_by uuid;
CREATE INDEX IF NOT EXISTS candidates_owner_idx ON public.candidates (org_id, owner_id);

-- 2. Ownership audit trail
CREATE TABLE public.candidate_ownership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  from_owner uuid,
  to_owner uuid,
  actor uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.candidate_ownership_events (candidate_id, created_at DESC);
GRANT SELECT, INSERT ON public.candidate_ownership_events TO authenticated;
GRANT ALL ON public.candidate_ownership_events TO service_role;
ALTER TABLE public.candidate_ownership_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read ownership events" ON public.candidate_ownership_events
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members write ownership events" ON public.candidate_ownership_events
  FOR INSERT TO authenticated WITH CHECK (org_id IS NULL OR public.is_org_member(org_id));
CREATE TRIGGER candidate_ownership_events_fill_org BEFORE INSERT ON public.candidate_ownership_events
  FOR EACH ROW EXECUTE FUNCTION public.fill_org_from_parent('candidates', 'candidate_id');

-- 3. Referrals: send a candidate to a colleague's role
CREATE TABLE public.candidate_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  from_user uuid NOT NULL,
  to_user uuid NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  response_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE INDEX ON public.candidate_referrals (org_id, to_user, status);
CREATE INDEX ON public.candidate_referrals (candidate_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_referrals TO authenticated;
GRANT ALL ON public.candidate_referrals TO service_role;
ALTER TABLE public.candidate_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read referrals" ON public.candidate_referrals
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members create referrals" ON public.candidate_referrals
  FOR INSERT TO authenticated WITH CHECK (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "org members update referrals" ON public.candidate_referrals
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members delete referrals" ON public.candidate_referrals
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));
CREATE TRIGGER candidate_referrals_fill_org BEFORE INSERT ON public.candidate_referrals
  FOR EACH ROW EXECUTE FUNCTION public.fill_org_from_parent('candidates', 'candidate_id');

-- 4. Talent requests: ask colleagues for candidates
CREATE TABLE public.talent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  requester_id uuid NOT NULL,
  title text NOT NULL,
  skills text[] NOT NULL DEFAULT '{}',
  note text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX ON public.talent_requests (org_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.talent_requests TO authenticated;
GRANT ALL ON public.talent_requests TO service_role;
ALTER TABLE public.talent_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read talent requests" ON public.talent_requests
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members create talent requests" ON public.talent_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org members update talent requests" ON public.talent_requests
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members delete talent requests" ON public.talent_requests
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));

CREATE TABLE public.talent_request_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  request_id uuid NOT NULL REFERENCES public.talent_requests(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  suggested_by uuid NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, candidate_id)
);
CREATE INDEX ON public.talent_request_suggestions (request_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.talent_request_suggestions TO authenticated;
GRANT ALL ON public.talent_request_suggestions TO service_role;
ALTER TABLE public.talent_request_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read suggestions" ON public.talent_request_suggestions
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members create suggestions" ON public.talent_request_suggestions
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "org members update suggestions" ON public.talent_request_suggestions
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members delete suggestions" ON public.talent_request_suggestions
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));

-- 5. Candidate notes with @mentions
CREATE TABLE public.candidate_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_name text,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.candidate_notes (candidate_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_notes TO authenticated;
GRANT ALL ON public.candidate_notes TO service_role;
ALTER TABLE public.candidate_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read notes" ON public.candidate_notes
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members create notes" ON public.candidate_notes
  FOR INSERT TO authenticated WITH CHECK (org_id IS NULL OR public.is_org_member(org_id));
CREATE POLICY "org members update notes" ON public.candidate_notes
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY "org members delete notes" ON public.candidate_notes
  FOR DELETE TO authenticated USING (public.is_org_member(org_id));
CREATE TRIGGER candidate_notes_fill_org BEFORE INSERT ON public.candidate_notes
  FOR EACH ROW EXECUTE FUNCTION public.fill_org_from_parent('candidates', 'candidate_id');

-- 6. Opt-in cross-organisation pool sharing (consortium)
CREATE TABLE public.org_pool_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  partner_org uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  scope text,
  requested_by uuid,
  responded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (owner_org, partner_org)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_pool_shares TO authenticated;
GRANT ALL ON public.org_pool_shares TO service_role;
ALTER TABLE public.org_pool_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "either side reads shares" ON public.org_pool_shares
  FOR SELECT TO authenticated USING (public.is_org_member(owner_org) OR public.is_org_member(partner_org));
CREATE POLICY "either side creates shares" ON public.org_pool_shares
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(owner_org) OR public.is_org_member(partner_org));
CREATE POLICY "either side updates shares" ON public.org_pool_shares
  FOR UPDATE TO authenticated USING (public.is_org_member(owner_org) OR public.is_org_member(partner_org));
CREATE POLICY "either side deletes shares" ON public.org_pool_shares
  FOR DELETE TO authenticated USING (public.is_org_member(owner_org) OR public.is_org_member(partner_org));

-- Consortium read access to candidates, without RLS recursion
CREATE OR REPLACE FUNCTION public.shares_pool_with_me(_owner_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_pool_shares s
    WHERE s.owner_org = _owner_org
      AND s.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = s.partner_org AND m.user_id = auth.uid() AND m.status = 'active'
      )
  )
$$;

CREATE POLICY "consortium partners read shared candidates" ON public.candidates
  FOR SELECT TO authenticated USING (public.shares_pool_with_me(org_id));
