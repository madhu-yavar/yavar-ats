-- 2026-10-06 — Platform-level settings (platform console → Transactional email).
-- Deployment-level configuration owned by platform super users: one row per
-- setting key, value encrypted at rest with SECRET_ENCRYPTION_KEY
-- (enc:v1.<iv>.<ct>.<tag> envelope, src/server/crypto.ts). Currently stores the
-- transactional-email (Resend) credential so the key can be rotated from the
-- platform console without touching the deployment secret.
-- Idempotent: re-running is a no-op.
create table if not exists platform_settings (
  key text primary key,
  value_encrypted text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
