CREATE TABLE IF NOT EXISTS public.onboarding_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  doc_type text NOT NULL,
  file_name text NOT NULL,
  file_path text,
  file_bytes integer,
  content_type text,
  source text DEFAULT 'upload' NOT NULL,
  inbox_message_id uuid,
  extracted_text text,
  extracted jsonb,
  extraction_status text DEFAULT 'pending' NOT NULL,
  extraction_note text,
  model text,
  status text DEFAULT 'pending' NOT NULL,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS onboarding_documents_org_app_idx ON public.onboarding_documents (org_id, application_id, created_at);
CREATE INDEX IF NOT EXISTS onboarding_documents_org_status_idx ON public.onboarding_documents (org_id, status);

-- Authorization is enforced in server code (requireOrg + explicit org_id predicates);
-- the Data API roles get no access to this table at all.
REVOKE ALL ON TABLE public.onboarding_documents FROM anon, authenticated;
GRANT ALL ON TABLE public.onboarding_documents TO service_role;
ALTER TABLE public.onboarding_documents ENABLE ROW LEVEL SECURITY;