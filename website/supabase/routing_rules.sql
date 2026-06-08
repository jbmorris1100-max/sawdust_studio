-- Run this in Supabase SQL Editor before deploying

CREATE TABLE IF NOT EXISTS public.routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 0,
  condition_field text NOT NULL, -- 'part_name' | 'material' | 'unit_label' | 'cabinet_type'
  condition_operator text NOT NULL, -- 'contains' | 'equals' | 'starts_with'
  condition_value text NOT NULL,
  assigned_dept text NOT NULL, -- 'production' | 'craftsman' | 'finishing' | 'assembly'
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routing_rules_tenant_priority ON public.routing_rules(tenant_id, priority);

ALTER TABLE public.routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON public.routing_rules USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

-- Seed default rules for new tenants (these mirror the current hardcoded logic):
-- These are inserted per-tenant on first load if no rules exist (handled in the UI component).
