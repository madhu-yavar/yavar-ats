-- Screening recordings live in org/candidate folders; only members of that
-- organisation may read them, and writes go through the service role.
CREATE POLICY "screening_audio_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'screening-audio'
    AND public.is_org_member((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY "screening_audio_member_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'screening-audio'
    AND public.is_org_member((split_part(name, '/', 1))::uuid)
  );