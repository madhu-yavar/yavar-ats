ALTER TABLE "candidates" ADD COLUMN "suspected_prompt_injection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP TABLE IF EXISTS "linkedin_oauth_states";
