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

ALTER TABLE public.part_dept_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.part_dept_events USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));
