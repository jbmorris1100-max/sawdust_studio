-- Run this in Supabase SQL Editor before deploying

CREATE TABLE IF NOT EXISTS public.part_dept_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  cabinet_unit_id uuid NOT NULL,
  job_number text,
  from_dept text,
  to_dept text NOT NULL,
  worker_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS part_dept_events_part ON public.part_dept_events(part_id);
CREATE INDEX IF NOT EXISTS part_dept_events_cabinet ON public.part_dept_events(cabinet_unit_id);
CREATE INDEX IF NOT EXISTS part_dept_events_tenant ON public.part_dept_events(tenant_id, created_at DESC);

-- The shop floor writes/reads this table under the anon key (crew have no
-- Supabase Auth session — see app/api/crew-auth), so an owner-only policy
-- (auth.uid()) silently drops every crew push and hides the rows from the
-- supervisor drill-downs. Mirror the shift_events anon-open pattern — the two
-- log tables are written side-by-side in pushPart(). See migration
-- 20260701000000_part_dept_events_rls.sql for the full rationale.
ALTER TABLE public.part_dept_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.part_dept_events;
CREATE POLICY "anon all part_dept_events" ON public.part_dept_events
  FOR ALL USING (true) WITH CHECK (true);
