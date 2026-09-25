-- Global integration templates (org_id IS NULL).
-- Run ONCE per fresh database. The app copies these into each organisation
-- automatically on the first visit to the Integrations page
-- (listSourceIntegrations -> ensureOrgIntegrations).
-- Idempotent-ish: re-running duplicates templates, so guard with the check
-- below or verify `SELECT count(*) FROM source_integrations WHERE org_id IS NULL;` first.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM source_integrations WHERE org_id IS NULL) THEN
    INSERT INTO source_integrations
      (provider, label, enabled, config, credential_fields, has_credentials, last_test_status, last_test_message, category) VALUES
    ('linkedin', 'LinkedIn Talent Solutions', false,
     '{"docs":"https://learn.microsoft.com/linkedin/talent/","notes":"Recruiter System Connect / Job Postings API. Candidate profiles cannot be read via the public API."}',
     '{client_id,client_secret}', false, 'untested', NULL, 'sourcing'),
    ('naukri', 'Naukri Resdex / Recruiter API', false,
     '{"docs":"https://www.naukri.com/recruiter","notes":"Enterprise Resdex subscription required for resume search and applicant pulls."}',
     '{client_id,client_secret,account_id}', false, 'untested', NULL, 'sourcing'),
    ('indeed', 'Indeed Apply + Job Feed', false,
     '{"docs":"https://docs.indeed.com/","notes":"Job XML feed plus Indeed Apply webhook for applicants."}',
     '{api_key,employer_id}', false, 'untested', NULL, 'sourcing'),
    ('github', 'GitHub Public API', true,
     '{"docs":"https://docs.github.com/rest","notes":"Token is optional; it raises the rate limit from 60 to 5000 requests/hour."}',
     '{token}', false, 'ok', 'Built-in source — no credentials required.', 'sourcing'),
    ('careers', 'Careers page / email applies', true,
     '{"notes":"Always available. Candidates added manually or by resume paste."}',
     '{}', false, 'ok', 'Built-in source — no credentials required.', 'sourcing'),
    ('zoom', 'Zoom (meeting links)', false, '{}',
     '{account_id,client_id,client_secret}', false, 'untested', NULL, 'meeting'),
    ('google_meet', 'Google Calendar / Meet', false, '{}',
     '{client_id,client_secret,refresh_token}', false, 'untested', NULL, 'meeting'),
    ('teams', 'Microsoft Teams', false, '{}',
     '{tenant_id,client_id,client_secret,organizer_email}', false, 'untested', NULL, 'meeting');
  END IF;
END $$;
