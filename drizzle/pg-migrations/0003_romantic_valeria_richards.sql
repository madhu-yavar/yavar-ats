ALTER TABLE "content_templates" ADD COLUMN "source_path" text;--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "source_name" text;--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "source_content_type" text;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "template_name" text;