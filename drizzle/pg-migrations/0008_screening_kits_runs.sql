CREATE TABLE "screening_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"candidate_id" uuid NOT NULL,
	"requisition_id" uuid,
	"application_id" uuid,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus_summary" text,
	"engine" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"kit_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"requisition_id" uuid,
	"application_id" uuid,
	"input_kind" text DEFAULT 'typed' NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript" text,
	"audio_path" text,
	"audio_engine" text,
	"screening_score" integer DEFAULT 0 NOT NULL,
	"match_score" integer,
	"combined_score" integer,
	"verdicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"red_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"rationale" text,
	"recommendation" text,
	"recommendation_reason" text,
	"engine" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_kit_id_screening_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."screening_kits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screening_kits_candidate_idx" ON "screening_kits" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_kits_org_idx" ON "screening_kits" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "screening_runs_kit_idx" ON "screening_runs" USING btree ("kit_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_runs_candidate_idx" ON "screening_runs" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_runs_org_created_idx" ON "screening_runs" USING btree ("org_id","created_at");