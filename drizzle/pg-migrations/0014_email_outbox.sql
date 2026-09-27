CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "application_id" uuid REFERENCES "applications"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "template_name" text NOT NULL,
  "to_email" text NOT NULL,
  "reply_to" text,
  "template_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_outbox_idempotency_key" ON "email_outbox" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "email_outbox_queue_idx" ON "email_outbox" ("status","available_at");
CREATE INDEX IF NOT EXISTS "email_outbox_application_kind_status_idx" ON "email_outbox" ("application_id","kind","status");
CREATE INDEX IF NOT EXISTS "email_outbox_org_kind_created_idx" ON "email_outbox" ("org_id","kind","created_at");

CREATE TABLE IF NOT EXISTS "email_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "singleton" boolean DEFAULT true NOT NULL,
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT true NOT NULL,
  "ack_enabled" boolean DEFAULT true NOT NULL,
  "stage_enabled" boolean DEFAULT true NOT NULL,
  "interview_enabled" boolean DEFAULT true NOT NULL,
  "offer_enabled" boolean DEFAULT true NOT NULL,
  "reply_to" text,
  "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_settings_org_key" ON "email_settings" ("org_id");
