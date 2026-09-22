-- Self-hosted sign-in: local users, sessions, single-use auth tokens and
-- login throttling. Idempotent, so it is safe on a deployment where some of
-- these tables already exist.

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "email_confirmed_at" timestamptz,
  "password_hash" text,
  "full_name" text,
  "avatar_url" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_login_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique_idx" ON "users" (lower("email"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_used_at" timestamptz DEFAULT now() NOT NULL,
  "user_agent" text,
  "ip" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('confirm', 'reset'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_tokens_user_idx" ON "auth_tokens" ("user_id", "purpose");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "ip" text,
  "success" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_email_idx" ON "login_attempts" ("email", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_attempts_ip_idx" ON "login_attempts" ("ip", "created_at");
--> statement-breakpoint
-- Carry over identities that already exist in this database's auth schema, so
-- current accounts (including the platform super user) keep their passwords.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    INSERT INTO "users" ("id", "email", "email_confirmed_at", "password_hash", "full_name", "created_at")
    SELECT au.id, au.email, au.email_confirmed_at, au.encrypted_password,
           au.raw_user_meta_data ->> 'full_name', au.created_at
    FROM auth.users au
    WHERE au.email IS NOT NULL
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;
