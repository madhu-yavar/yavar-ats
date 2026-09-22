CREATE TABLE IF NOT EXISTS "comp_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"requisition_id" uuid REFERENCES "requisitions"("id") ON DELETE set null,
	"role_key" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"level_key" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"low" numeric,
	"median" numeric NOT NULL,
	"high" numeric,
	"experience_min" integer,
	"experience_max" integer,
	"source" text DEFAULT 'user_override' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comp_knowledge_org_role_idx" ON "comp_knowledge" ("org_id","role_key","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comp_knowledge_org_created_idx" ON "comp_knowledge" ("org_id","created_at");
