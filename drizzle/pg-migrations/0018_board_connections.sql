-- 0018_board_connections.sql — enterprise job-board connections (LinkedIn / Indeed / Naukri)
--
-- Adds syndication state, inbound webhook ingestion and per-connection poll
-- health for the three partner boards, plus the missing per-org
-- source_integrations rows (orgs created before the seeding hook existed got
-- an empty Integrations page).

-- 1) Posting syndication state, one row per (requisition, provider).
CREATE TABLE IF NOT EXISTS "requisition_board_postings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "requisition_id" uuid NOT NULL REFERENCES "requisitions"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "external_id" text,
  "external_url" text,
  -- Last posted body — non-secret by construction, never carries AI-vendor fields.
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "published_by" uuid,
  "published_at" timestamptz,
  "closed_at" timestamptz,
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "board_postings_req_provider_key"
  ON "requisition_board_postings" ("requisition_id", "provider");
CREATE INDEX IF NOT EXISTS "board_postings_org_status_idx"
  ON "requisition_board_postings" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "board_postings_provider_external_idx"
  ON "requisition_board_postings" ("provider", "external_id") WHERE "external_id" IS NOT NULL;

-- 2) Raw inbound webhook events: idempotency key, replay/forensics trail and
--    PII-bounded retention (board-sync purges terminal rows after 30 days).
CREATE TABLE IF NOT EXISTS "board_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- "<provider>:<orgId|unknown>:<external_event_id>"
  "dedupe_key" text NOT NULL,
  -- NULL when the org could not be resolved from the delivery token.
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "external_event_id" text NOT NULL,
  -- Allowlisted headers only (content-type, user-agent, signature).
  "headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "requisition_id" uuid,
  "candidate_id" uuid,
  "application_id" uuid,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "board_webhook_events_dedupe_key"
  ON "board_webhook_events" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "board_webhook_events_status_idx"
  ON "board_webhook_events" ("status", "received_at");
CREATE INDEX IF NOT EXISTS "board_webhook_events_org_idx"
  ON "board_webhook_events" ("org_id", "received_at");

-- 3) Per-org, per-provider webhook delivery token, mirroring the capture-token
--    precedent (0009): encrypted display copy plus sha256 hash lookup key.
ALTER TABLE "source_integrations"
  ADD COLUMN IF NOT EXISTS "webhook_token" text,
  ADD COLUMN IF NOT EXISTS "webhook_token_hash" text,
  ADD COLUMN IF NOT EXISTS "webhook_configured_at" timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS "source_integrations_webhook_token_hash_key"
  ON "source_integrations" ("webhook_token_hash") WHERE "webhook_token_hash" IS NOT NULL;

-- 4) Poll watermark and run health per connection.
CREATE TABLE IF NOT EXISTS "board_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "integration_id" uuid NOT NULL REFERENCES "source_integrations"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "last_polled_at" timestamptz,
  "last_run_at" timestamptz,
  "last_run_status" text NOT NULL DEFAULT 'idle',
  "last_error" text,
  "stats" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "board_sync_state_integration_key"
  ON "board_sync_state" ("integration_id");

-- 5) Backfill the per-org source_integrations rows for every organisation that
--    predates the seeding hook (idempotent; the catalog matches the fixture).
INSERT INTO "source_integrations"
  ("org_id", "provider", "label", "enabled", "category", "config", "credential_fields")
SELECT o.id, p.provider, p.label, false, p.category, p.config::jsonb, p.fields::text[]
FROM "organizations" o
CROSS JOIN (VALUES
  ('linkedin', 'LinkedIn Talent Solutions', 'sourcing',
   '{"docs":"https://learn.microsoft.com/linkedin/talent/","notes":"Recruiter System Connect / Job Postings API. Candidate profiles cannot be read via the public API."}',
   ARRAY['client_id','client_secret']),
  ('naukri', 'Naukri Resdex / Recruiter API', 'sourcing',
   '{"docs":"https://www.naukri.com/recruiter","notes":"Enterprise Resdex subscription required for resume search and applicant pulls."}',
   ARRAY['client_id','client_secret','account_id']),
  ('indeed', 'Indeed Apply + Job Feed', 'sourcing',
   '{"docs":"https://docs.indeed.com/","notes":"Job feed plus the Indeed Apply webhook for applicants."}',
   ARRAY['client_id','client_secret','employer_id']),
  ('github', 'GitHub Public API', 'sourcing',
   '{"notes":"Token optional; it raises the rate limit from 60 to 5000 requests/hour."}',
   ARRAY['token']),
  ('careers', 'Careers page / email applies', 'sourcing',
   '{"notes":"Always available. Candidates added manually or by resume paste."}',
   ARRAY[]::text[]),
  ('zoom', 'Zoom (meeting links)', 'meeting', '{}',
   ARRAY['account_id','client_id','client_secret']),
  ('google_meet', 'Google Calendar / Meet', 'meeting', '{}',
   ARRAY['client_id','client_secret','refresh_token']),
  ('teams', 'Microsoft Teams', 'meeting', '{}',
   ARRAY['tenant_id','client_id','client_secret','organizer_email'])
) AS p(provider, label, category, config, fields)
WHERE o."status" IN ('active', 'pending')
ON CONFLICT DO NOTHING;

-- 6) Orgs whose rows predate the credential catalogs render empty credential
--    boxes — fill the empty ones in from the same catalog.
UPDATE "source_integrations" si
SET "credential_fields" = p.fields::text[]
FROM (VALUES
  ('linkedin', ARRAY['client_id','client_secret']),
  ('naukri', ARRAY['client_id','client_secret','account_id']),
  ('indeed', ARRAY['client_id','client_secret','employer_id']),
  ('github', ARRAY['token']),
  ('careers', ARRAY[]::text[]),
  ('zoom', ARRAY['account_id','client_id','client_secret']),
  ('google_meet', ARRAY['client_id','client_secret','refresh_token']),
  ('teams', ARRAY['tenant_id','client_id','client_secret','organizer_email'])
) AS p(provider, fields)
WHERE si."provider" = p.provider
  AND si."credential_fields" = '{}';
