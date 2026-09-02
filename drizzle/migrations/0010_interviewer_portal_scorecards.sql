ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS interviewer_email text,
  ADD COLUMN IF NOT EXISTS duration_mins integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS agenda text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.evaluations
  ADD COLUMN IF NOT EXISTS interview_id uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_by text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS interviews_interviewer_email_idx ON public.interviews (lower(interviewer_email));
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_interview_id_key ON public.evaluations (interview_id) WHERE interview_id IS NOT NULL;