-- Run this in the Supabase SQL Editor before deploying.
--
-- part_routing_patterns — the crew-driven routing learning table. Every time a
-- crew member pushes a part from one department to another, we upsert the
-- (part_name_pattern, from_dept, to_dept) row, bump times_confirmed, and
-- recompute confidence_score. The Push Picker reads the highest-confidence row
-- for a (part_name_pattern, from_dept) to pre-select the suggested destination.

CREATE TABLE IF NOT EXISTS public.part_routing_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  part_name_pattern text NOT NULL,
  from_dept text NOT NULL,
  to_dept text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0,
  times_confirmed integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, part_name_pattern, from_dept, to_dept)
);

CREATE INDEX IF NOT EXISTS part_routing_patterns_lookup
  ON public.part_routing_patterns(tenant_id, part_name_pattern, from_dept);

ALTER TABLE public.part_routing_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.part_routing_patterns
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));
