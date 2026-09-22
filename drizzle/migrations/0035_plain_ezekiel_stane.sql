CREATE TYPE "public"."app_role" AS ENUM('recruiter', 'hiring_manager', 'department_head', 'hr_head', 'president_cbo');--> statement-breakpoint
CREATE TYPE "public"."app_stage" AS ENUM('sourced', 'applied', 'ai_screened', 'shortlisted', 'l1', 'l2', 'l3', 'offer', 'hired', 'rejected', 'offer_pending', 'offer_released', 'offer_accepted', 'offer_declined', 'joined', 'no_show', 'joining_deferred', 'withdrawn', 'on_hold', 'reserve');--> statement-breakpoint
CREATE TYPE "public"."jd_status" AS ENUM('draft', 'pending_dh', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'pending_hr', 'pending_cbo', 'approved', 'released', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('select', 'reject', 'hold');--> statement-breakpoint
CREATE TYPE "public"."req_status" AS ENUM('draft', 'pending_dh', 'pending_hr', 'pending_cbo', 'approved', 'rejected', 'on_hold', 'closed');--> statement-breakpoint
CREATE TYPE "public"."req_type" AS ENUM('new', 'replacement');--> statement-breakpoint
CREATE TABLE "ai_interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"jd_match_score" integer DEFAULT 0 NOT NULL,
	"skillset_score" integer DEFAULT 0 NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_credentials" (
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"org_id" uuid,
	"provider" text DEFAULT 'lovable' NOT NULL,
	"model" text DEFAULT 'google/gemini-3.7-flash' NOT NULL,
	"last_test_status" text DEFAULT 'untested' NOT NULL,
	"last_test_message" text,
	"last_tested_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"org_id" uuid,
	"stage" "app_stage" DEFAULT 'applied' NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_reason" text,
	"stage_note" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"requisition_id" uuid,
	"org_id" uuid,
	"token" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mindset_score" integer,
	"dimensions" jsonb,
	"red_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
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
CREATE TABLE "candidate_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"org_id" uuid,
	"authenticity_score" integer DEFAULT 0 NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"red_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"model" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"location" text,
	"source" text DEFAULT 'direct' NOT NULL,
	"experience_years" numeric(4, 1) DEFAULT '0' NOT NULL,
	"current_ctc" numeric(14, 2),
	"expected_ctc" numeric(14, 2),
	"notice_period_days" integer,
	"education" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"resume_text" text,
	"linkedin_url" text,
	"github_url" text,
	"website_url" text,
	"x_url" text,
	"consent_given" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"external_provider" text,
	"resume_file_path" text,
	"owner_id" uuid,
	"added_by" uuid,
	"is_internal" boolean DEFAULT false NOT NULL,
	"employee_id" text,
	"current_department" text,
	"manager_endorsed" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'never' NOT NULL,
	"current_employer" text,
	"work_authorization" text,
	"willing_to_relocate" boolean,
	"preferred_locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"suspected_prompt_injection" boolean DEFAULT false NOT NULL,
	"referral_source" text,
	"employment_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"career_metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "capture_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_url" text,
	"title" text,
	"status" text DEFAULT 'stored' NOT NULL,
	"detail" text,
	"candidate_id" uuid,
	"requisition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comp_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requisition_id" uuid,
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
	"background_path" text,
	"background_content_type" text,
	"source_path" text,
	"source_name" text,
	"source_content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_templates_kind_check" CHECK ("content_templates"."kind" in ('linkedin_post','jd','job_card','offer_letter'))
);
--> statement-breakpoint
CREATE TABLE "copilot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"head_name" text,
	"budgeted_headcount" integer DEFAULT 0 NOT NULL,
	"budgeted_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"period" text DEFAULT 'FY26' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"level" integer NOT NULL,
	"evaluator" text,
	"focus_area" text,
	"rating" integer,
	"comments" text,
	"recommendation" "recommendation" DEFAULT 'hold' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interview_id" uuid,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hr_incentive_schemes" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"target_closures_per_month" integer DEFAULT 3 NOT NULL,
	"payout_per_closure" numeric DEFAULT '10000' NOT NULL,
	"quality_bands" jsonb DEFAULT '[{"min_score":85,"multiplier":1.2},{"min_score":70,"multiplier":1},{"min_score":0,"multiplier":0.8}]'::jsonb NOT NULL,
	"monthly_cap" numeric,
	"notes" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"to_address" text,
	"from_email" text,
	"from_name" text,
	"subject" text,
	"body" text,
	"attachment_name" text,
	"attachment_bytes" integer,
	"status" text DEFAULT 'received' NOT NULL,
	"detail" text,
	"candidate_id" uuid,
	"requisition_id" uuid,
	"provider_message_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"level" integer DEFAULT 1 NOT NULL,
	"interviewer" text,
	"scheduled_at" timestamp with time zone,
	"teams_link" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interviewer_email" text,
	"duration_mins" integer DEFAULT 60 NOT NULL,
	"mode" text DEFAULT 'online' NOT NULL,
	"agenda" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_descriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"org_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "jd_status" DEFAULT 'draft' NOT NULL,
	"purpose" text,
	"responsibilities" text,
	"must_have" text[] DEFAULT '{}'::text[] NOT NULL,
	"good_to_have" text[] DEFAULT '{}'::text[] NOT NULL,
	"qualifications" text,
	"success_factors" text,
	"reporting_to" text,
	"full_text" text,
	"approver_comment" text,
	"template_id" uuid,
	"template_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_items_kind_check" CHECK ("master_items"."kind" in ('skill','location','education','employment_type','industry','role_title','billing_type','engagement_type','client','rejection_reason'))
);
--> statement-breakpoint
CREATE TABLE "match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"skills_score" integer DEFAULT 0 NOT NULL,
	"experience_score" integer DEFAULT 0 NOT NULL,
	"career_score" integer DEFAULT 0 NOT NULL,
	"impact_score" integer DEFAULT 0 NOT NULL,
	"innovation_score" integer DEFAULT 0 NOT NULL,
	"education_score" integer DEFAULT 0 NOT NULL,
	"social_score" integer DEFAULT 0 NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"weights" jsonb DEFAULT '{"skills":50,"experience":25,"education":10,"social":15}'::jsonb NOT NULL,
	"matched_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"missing_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"rationale" text,
	"risk_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"recommendation" "recommendation",
	"model" text,
	"recruiter_override" "recommendation",
	"override_reason" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"career_metrics" jsonb,
	"career_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"logistics_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"impact_highlights" text[] DEFAULT '{}'::text[] NOT NULL,
	"innovation_signals" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"offered_ctc" numeric(14, 2) DEFAULT '0' NOT NULL,
	"joining_date" date,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"approval_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"letter" jsonb,
	"letter_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "org_linkedin_connections" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"member_sub" text NOT NULL,
	"member_name" text,
	"member_email" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"full_name" text,
	"title" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"invited_role" "app_role",
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone
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
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"email_domain" text,
	"inbox_slug" text,
	"legal_name" text,
	"industry" text,
	"hq_country" text,
	"hq_city" text,
	"employee_band" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 4 NOT NULL,
	"careers_email" text,
	"onboarding_step" text DEFAULT 'profile' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"capture_token" text,
	"capture_token_hash" text
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"req_type" "req_type" DEFAULT 'new' NOT NULL,
	"status" "req_status" DEFAULT 'draft' NOT NULL,
	"location" text,
	"openings" integer DEFAULT 1 NOT NULL,
	"experience_min" integer DEFAULT 0 NOT NULL,
	"experience_max" integer DEFAULT 5 NOT NULL,
	"budget_ctc" numeric(14, 2) DEFAULT '0' NOT NULL,
	"hiring_manager" text,
	"must_have_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"good_to_have_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"responsibilities" text,
	"education_requirement" text,
	"weight_skills" integer DEFAULT 40 NOT NULL,
	"weight_experience" integer DEFAULT 15 NOT NULL,
	"weight_career" integer DEFAULT 10 NOT NULL,
	"weight_impact" integer DEFAULT 10 NOT NULL,
	"weight_education" integer DEFAULT 10 NOT NULL,
	"weight_social" integer DEFAULT 15 NOT NULL,
	"approval_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"billing_type" text DEFAULT 'non_billable' NOT NULL,
	"engagement_type" text DEFAULT 'internal' NOT NULL,
	"client_name" text,
	"cost_center" text,
	"ijp_enabled" boolean DEFAULT false NOT NULL,
	"ijp_posted_at" timestamp with time zone,
	"ijp_notes" text,
	"ctc_band_min" numeric(14, 2),
	"ctc_band_max" numeric(14, 2),
	"career_level" text,
	"job_card_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_notice_period_days" integer,
	"work_authorization_required" text
);
--> statement-breakpoint
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
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text
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
CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"org_id" uuid,
	"provider" text NOT NULL,
	"profile_url" text,
	"handle" text,
	"score" integer DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text,
	"raw" jsonb,
	"status" text DEFAULT 'ok' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'sourcing' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"has_credentials" boolean DEFAULT false NOT NULL,
	"last_test_status" text DEFAULT 'untested' NOT NULL,
	"last_test_message" text,
	"last_tested_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"org_id" uuid,
	"from_stage" "app_stage",
	"to_stage" "app_stage" NOT NULL,
	"actor" text,
	"reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_confirmed_at" timestamp with time zone,
	"password_hash" text,
	"full_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_interviews" ADD CONSTRAINT "ai_interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interviews" ADD CONSTRAINT "ai_interviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_credentials" ADD CONSTRAINT "ai_provider_credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessments" ADD CONSTRAINT "candidate_assessments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_ownership_events" ADD CONSTRAINT "candidate_ownership_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_ownership_events" ADD CONSTRAINT "candidate_ownership_events_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_referrals" ADD CONSTRAINT "candidate_referrals_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_verifications" ADD CONSTRAINT "candidate_verifications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_verifications" ADD CONSTRAINT "candidate_verifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_events" ADD CONSTRAINT "capture_events_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_knowledge" ADD CONSTRAINT "comp_knowledge_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_knowledge" ADD CONSTRAINT "comp_knowledge_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_incentive_schemes" ADD CONSTRAINT "hr_incentive_schemes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_integration_id_source_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."source_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_items" ADD CONSTRAINT "master_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_snapshots" ADD CONSTRAINT "ontology_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_linkedin_connections" ADD CONSTRAINT "org_linkedin_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_pool_shares" ADD CONSTRAINT "org_pool_shares_owner_org_organizations_id_fk" FOREIGN KEY ("owner_org") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_pool_shares" ADD CONSTRAINT "org_pool_shares_partner_org_organizations_id_fk" FOREIGN KEY ("partner_org") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_benchmarks" ADD CONSTRAINT "salary_benchmarks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_benchmarks" ADD CONSTRAINT "salary_benchmarks_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_kits" ADD CONSTRAINT "screening_kits_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_kit_id_screening_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."screening_kits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screening_runs" ADD CONSTRAINT "screening_runs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_edges" ADD CONSTRAINT "skill_edges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_evidence" ADD CONSTRAINT "skill_evidence_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_nodes" ADD CONSTRAINT "skill_nodes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_integrations" ADD CONSTRAINT "source_integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_request_id_talent_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."talent_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_request_suggestions" ADD CONSTRAINT "talent_request_suggestions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_requests" ADD CONSTRAINT "talent_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_requests" ADD CONSTRAINT "talent_requests_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_credentials_org_provider_key" ON "ai_provider_credentials" USING btree ("org_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_org_key" ON "ai_settings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_requisition_candidate_key" ON "applications" USING btree ("requisition_id","candidate_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_assessments_token_key" ON "candidate_assessments" USING btree ("token");--> statement-breakpoint
CREATE INDEX "candidate_assessments_candidate_idx" ON "candidate_assessments" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "candidate_verifications_candidate_idx" ON "candidate_verifications" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "candidates_skills_gin" ON "candidates" USING gin ("skills");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_external_unique" ON "candidates" USING btree ("external_provider","external_id") WHERE "candidates"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "capture_events_org_created_idx" ON "capture_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "comp_knowledge_org_role_idx" ON "comp_knowledge" USING btree ("org_id","role_key","created_at");--> statement-breakpoint
CREATE INDEX "comp_knowledge_org_created_idx" ON "comp_knowledge" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_org_kind_name_key" ON "content_templates" USING btree ("org_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_org_kind_default_key" ON "content_templates" USING btree ("org_id","kind") WHERE "content_templates"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_key" ON "departments" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_interview_id_key" ON "evaluations" USING btree ("interview_id") WHERE "evaluations"."interview_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_provider_key" ON "inbox_messages" USING btree ("org_id","provider_message_id") WHERE "inbox_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "inbox_messages_org_idx" ON "inbox_messages" USING btree ("org_id","received_at");--> statement-breakpoint
CREATE INDEX "interviews_interviewer_email_idx" ON "interviews" USING btree (lower("interviewer_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "master_items_kind_name_unique" ON "master_items" USING btree ("org_id","kind",lower("name"));--> statement-breakpoint
CREATE INDEX "master_items_kind_idx" ON "master_items" USING btree ("kind","active");--> statement-breakpoint
CREATE INDEX "match_scores_application_idx" ON "match_scores" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_email_key" ON "org_members" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_key" ON "org_members" USING btree ("org_id","user_id") WHERE "org_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_email_idx" ON "org_members" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "org_pool_shares_owner_partner_key" ON "org_pool_shares" USING btree ("owner_org","partner_org");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_capture_token_key" ON "organizations" USING btree ("capture_token");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_capture_token_hash_key" ON "organizations" USING btree ("capture_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_inbox_slug_key" ON "organizations" USING btree (lower("inbox_slug")) WHERE "organizations"."inbox_slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_careers_email_key" ON "organizations" USING btree (lower("careers_email")) WHERE "organizations"."careers_email" is not null;--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "organizations_email_domain_idx" ON "organizations" USING btree ("email_domain") WHERE "organizations"."email_domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "platform_admins_email_idx" ON "platform_admins" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "requisitions_org_code_key" ON "requisitions" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "salary_benchmarks_org_input_idx" ON "salary_benchmarks" USING btree ("org_id","input_key","created_at");--> statement-breakpoint
CREATE INDEX "screening_kits_candidate_idx" ON "screening_kits" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_kits_org_idx" ON "screening_kits" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "screening_runs_kit_idx" ON "screening_runs" USING btree ("kit_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_runs_candidate_idx" ON "screening_runs" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "screening_runs_org_created_idx" ON "screening_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_edges_org_key" ON "skill_edges" USING btree ("org_id","from_slug","to_slug","kind");--> statement-breakpoint
CREATE INDEX "skill_evidence_org_slug_idx" ON "skill_evidence" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_nodes_org_slug_key" ON "skill_nodes" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "social_profiles_candidate_provider_key" ON "social_profiles" USING btree ("candidate_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "source_integrations_org_provider_key" ON "source_integrations" USING btree ("org_id","provider");--> statement-breakpoint
CREATE INDEX "stage_events_application_idx" ON "stage_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_request_suggestions_req_cand_key" ON "talent_request_suggestions" USING btree ("request_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_org_user_role_key" ON "user_roles" USING btree ("org_id","user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");