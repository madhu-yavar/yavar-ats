-- 0021_linkedin_row_rename.sql — align the LinkedIn row with what the
-- registered app actually does.
--
-- The official ATSIQ LinkedIn app connects the organisation's own account and
-- publishes feed posts. "Talent Solutions" is the paid product line that is
-- explicitly NOT on the contract (the Integrations page carries a
-- ready-to-send request asking LinkedIn to add it), so the row no longer
-- claims it. Label matches INTEGRATION_CATALOG in
-- src/server/integration-seeds.server.ts. Idempotent: re-running is a no-op.

UPDATE source_integrations
SET label = 'LinkedIn (company account)',
    config = jsonb_build_object(
      'docs', 'https://developer.linkedin.com/',
      'notes', 'Connects the company''s own LinkedIn account. Job posts publish from it and applicants come back through your apply link. Structured Jobs-board listings and applicant sync need the paid Job Posting / Talent Solutions products on your LinkedIn contract.'
    ),
    updated_at = now()
WHERE provider = 'linkedin'
  AND (
    label IS DISTINCT FROM 'LinkedIn (company account)'
    OR config->>'notes' IS DISTINCT FROM 'Connects the company''s own LinkedIn account. Job posts publish from it and applicants come back through your apply link. Structured Jobs-board listings and applicant sync need the paid Job Posting / Talent Solutions products on your LinkedIn contract.'
  );
