ALTER TABLE public.source_integrations ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'sourcing';

INSERT INTO public.source_integrations (provider, label, category, enabled, config, credential_fields, has_credentials, last_test_status)
VALUES
  ('zoom', 'Zoom (meeting links)', 'meeting', false, '{}'::jsonb, ARRAY['account_id','client_id','client_secret'], false, 'untested'),
  ('google_meet', 'Google Calendar / Meet', 'meeting', false, '{}'::jsonb, ARRAY['client_id','client_secret','refresh_token'], false, 'untested'),
  ('teams', 'Microsoft Teams', 'meeting', false, '{}'::jsonb, ARRAY['tenant_id','client_id','client_secret','organizer_email'], false, 'untested')
ON CONFLICT DO NOTHING;