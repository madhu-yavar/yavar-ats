CREATE TABLE "salary_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requisition_id" uuid,
	"input_key" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"experience_min" integer DEFAULT 0 NOT NULL,
	"experience_max" integer DEFAULT 5 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"grounded" boolean DEFAULT false NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"payload" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "career_level" text;--> statement-breakpoint
ALTER TABLE "salary_benchmarks" ADD CONSTRAINT "salary_benchmarks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_benchmarks" ADD CONSTRAINT "salary_benchmarks_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salary_benchmarks_org_input_idx" ON "salary_benchmarks" USING btree ("org_id","input_key","created_at");