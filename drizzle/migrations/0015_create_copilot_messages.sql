CREATE TABLE public.copilot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX copilot_messages_user_idx ON public.copilot_messages (user_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.copilot_messages TO authenticated;
GRANT ALL ON public.copilot_messages TO service_role;

ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own copilot read" ON public.copilot_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own copilot insert" ON public.copilot_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own copilot delete" ON public.copilot_messages
  FOR DELETE TO authenticated USING (user_id = auth.uid());