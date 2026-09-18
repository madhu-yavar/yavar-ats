-- Meeting providers switch from pasted admin credentials to delegated OAuth
-- connects. Hide the paste fields on the three meeting rows; legacy secrets
-- keep working via the fallback paths in meetings.server.ts.
UPDATE public.source_integrations
SET credential_fields = ARRAY[]::text[]
WHERE category = 'meeting' AND provider IN ('zoom', 'google_meet', 'teams');
