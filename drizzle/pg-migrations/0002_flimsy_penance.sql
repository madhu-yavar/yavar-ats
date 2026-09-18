CREATE TABLE "candidate_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"candidate_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" text,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_ownership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"candidate_id" uuid NOT NULL,
	"from_owner" uuid,
	"to_owner" uuid,
	"actor" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"candidate_id" uuid NOT NULL,
	"requisition_id" uuid,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" text,
	"logo_path" text,
	"logo_content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_templates_kind_check" CHECK ("content_templates"."kind" in ('linkedin_post','jd','job_card'))
);
--> statement-breakpoint
CREATE TABLE "ontology_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"added" text[] DEFAULT '{}' NOT NULL,
	"grown" text[] DEFAULT '{}' NOT NULL,
	"dormant" text[] DEFAULT '{}' NOT NULL,
	"retired" text[] DEFAULT '{}' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_pool_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_org" uuid NOT NULL,
	"partner_org" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope" text,
	"requested_by" uuid,
	"responded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_catalogue_commercials" (
	"module_id" text PRIMARY KEY NOT NULL,
	"tier" text,
	"list_price" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"unit" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "skill_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_slug" text NOT NULL,
	"to_slug" text NOT NULL,
	"kind" text DEFAULT 'cooccurs' NOT NULL,
	"weight" numeric DEFAULT '0' NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"candidate_id" uuid,
	"requisition_id" uuid,
	"source" text NOT NULL,
	"strength" numeric DEFAULT '1' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"parent_slug" text,
	"supply" integer DEFAULT 0 NOT NULL,
	"demand" integer DEFAULT 0 NOT NULL,
	"validated" integer DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_request_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"suggested_by" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requisition_id" uuid,
	"requester_id" uuid NOT NULL,
	"title" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_ownership_events" ADD CONSTRAINT "candidate_ownership_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_ownership_events" ADD CONSTRAINT "candidate_ownership_events_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_snapshots" ADD CONSTRAINT "ontology_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_pool_shares" ADD CONSTRAINT "org_pool_shares_owner_org_organizations_id_fk" FOREIGN KEY ("owner_org") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_pool_shares" ADD CONSTRAINT "org_pool_shares_partner_org_organizations_id_fk" FOREIGN KEY ("partner_org") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_nodes" ADD CONSTRAINT "skill_nodes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_request_id_talent_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."talent_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_requests" ADD CONSTRAINT "talent_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_requests" ADD CONSTRAINT "talent_requests_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_org_kind_name_key" ON "content_templates" USING btree ("org_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_org_kind_default_key" ON "content_templates" USING btree ("org_id","kind") WHERE "content_templates"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "org_pool_shares_owner_partner_key" ON "org_pool_shares" USING btree ("owner_org","partner_org");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_edges_org_key" ON "skill_edges" USING btree ("org_id","from_slug","to_slug","kind");--> statement-breakpoint
CREATE INDEX "skill_evidence_org_slug_idx" ON "skill_evidence" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_nodes_org_slug_key" ON "skill_nodes" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_request_suggestions_req_cand_key" ON "talent_request_suggestions" USING btree ("request_id","candidate_id");