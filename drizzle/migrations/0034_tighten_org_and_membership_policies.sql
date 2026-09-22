-- Organisations may only be created by the signed-in user, recorded as creator.
DROP POLICY IF EXISTS "anyone creates an org" ON public.organizations;
CREATE POLICY "signed in user creates own org"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

-- Membership edits: owners may change anything; a person may edit their own row
-- but can never grant themselves ownership.
DROP POLICY IF EXISTS "owners or self update membership" ON public.org_members;
CREATE POLICY "owners or self update membership"
ON public.org_members
FOR UPDATE
TO authenticated
USING (
  is_org_owner(org_id)
  OR user_id = auth.uid()
  OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
)
WITH CHECK (
  is_org_owner(org_id)
  OR (
    (user_id = auth.uid() OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')))
    AND is_owner IS NOT TRUE
  )
);

-- The invite policy's bootstrap clause compared a column to itself, which was
-- always true. Restrict it to genuinely empty organisations.
DROP POLICY IF EXISTS "owners invite" ON public.org_members;
CREATE POLICY "owners invite"
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (
  is_org_owner(org_id)
  OR NOT EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = org_members.org_id
  )
);
