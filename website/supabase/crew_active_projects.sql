-- Run this in Supabase SQL Editor before deploying

CREATE TABLE IF NOT EXISTS public.crew_active_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  worker_name text NOT NULL,
  dept text NOT NULL,                    -- which dept this project is in
  cabinet_unit_id uuid NOT NULL,
  unit_label text NOT NULL,
  job_number text,
  time_clock_id uuid,                    -- current open time_clock row (null when paused)
  session_start timestamptz,             -- when current session started (null when paused)
  accumulated_seconds integer DEFAULT 0, -- total seconds from all previous sessions
  status text DEFAULT 'active',          -- 'active' | 'paused'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- One active/paused project per worker (lets us upsert on conflict).
CREATE UNIQUE INDEX IF NOT EXISTS crew_active_projects_worker
  ON public.crew_active_projects(tenant_id, worker_name);

ALTER TABLE public.crew_active_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.crew_active_projects USING (
  tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid())
);
