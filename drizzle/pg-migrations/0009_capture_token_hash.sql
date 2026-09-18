ALTER TABLE "organizations" ADD COLUMN "capture_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_capture_token_hash_key" ON "organizations" ("capture_token_hash");
