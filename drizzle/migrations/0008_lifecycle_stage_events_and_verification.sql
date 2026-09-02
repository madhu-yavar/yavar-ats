-- 1. Extend the application stage enum to cover the real hiring lifecycle
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'sourced' BEFORE 'applied';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'offer_pending';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'offer_released';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'offer_accepted';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'offer_declined';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'joined';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'no_show';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'joining_deferred';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.app_stage ADD VALUE IF NOT EXISTS 'reserve';

-- 2. Pipeline bookkeeping on applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stage_reason text,
  ADD COLUMN IF NOT EXISTS stage_note text;

-- 3. Sync bookkeeping on candidates
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'never';

ALTER TABLE public.social_profiles
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
