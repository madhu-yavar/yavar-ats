CREATE TABLE public.master_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('skill','location','education','employment_type','industry')),
  name text NOT NULL,
  category text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX master_items_kind_name_unique ON public.master_items (kind, lower(name));
CREATE INDEX master_items_kind_idx ON public.master_items (kind, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_items TO authenticated;
GRANT ALL ON public.master_items TO service_role;

ALTER TABLE public.master_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read master_items" ON public.master_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write master_items" ON public.master_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update master_items" ON public.master_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete master_items" ON public.master_items FOR DELETE TO authenticated USING (true);