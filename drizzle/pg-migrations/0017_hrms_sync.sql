-- HRMS sync: employee-master cache, per-connection sync state and field mappings.
-- Connections live in source_integrations (category 'hrms', no schema change needed).

CREATE TABLE IF NOT EXISTS "hrms_employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "integration_id" uuid NOT NULL REFERENCES "source_integrations"("id") ON DELETE CASCADE,
  "external_id" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "employee_code" text,
  "department" text,
  "job_title" text,
  "location" text,
  "manager_external_id" text,
  "employment_status" text DEFAULT 'active' NOT NULL,
  "joined_on" text,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hrms_employees_integration_external_key" ON "hrms_employees" ("integration_id","external_id");
CREATE INDEX IF NOT EXISTS "hrms_employees_org_department_idx" ON "hrms_employees" ("org_id","department");

CREATE TABLE IF NOT EXISTS "hrms_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "integration_id" uuid NOT NULL REFERENCES "source_integrations"("id") ON DELETE CASCADE,
  "entity" text DEFAULT 'employees' NOT NULL,
  "cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_full_sync_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "last_run_status" text DEFAULT 'idle' NOT NULL,
  "last_error" text,
  "stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hrms_sync_state_integration_entity_key" ON "hrms_sync_state" ("integration_id","entity");

CREATE TABLE IF NOT EXISTS "hrms_field_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "integration_id" uuid NOT NULL REFERENCES "source_integrations"("id") ON DELETE CASCADE,
  "mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hrms_field_mappings_integration_key" ON "hrms_field_mappings" ("integration_id");
