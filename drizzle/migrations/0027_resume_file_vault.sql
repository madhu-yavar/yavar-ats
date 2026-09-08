-- Original CV files live in the private 'resumes' storage bucket, one folder
-- per organisation: <org_id>/<candidate_id>/<filename>. This column points at it.
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS resume_file_path text;

-- Only members of the organisation that owns the folder may read or write CVs
-- inside it. Nobody outside the org can list or download another tenant's CVs.
CREATE POLICY "Org members can read their CV files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.is_org_member(((string_to_array(name, '/'))[1])::uuid)
);

CREATE POLICY "Org members can add CV files to their own vault"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'resumes'
  AND public.is_org_member(((string_to_array(name, '/'))[1])::uuid)
);

CREATE POLICY "Org members can replace their CV files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.is_org_member(((string_to_array(name, '/'))[1])::uuid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;