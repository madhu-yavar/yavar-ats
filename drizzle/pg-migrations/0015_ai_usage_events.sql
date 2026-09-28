CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "feature" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" text NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "duration_ms" integer,
  "grounded" boolean,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_org_created_idx" ON "ai_usage_events" ("org_id","created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_feature_created_idx" ON "ai_usage_events" ("feature","created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_model_idx" ON "ai_usage_events" ("model");
CREATE INDEX IF NOT EXISTS "ai_usage_events_created_idx" ON "ai_usage_events" ("created_at");
