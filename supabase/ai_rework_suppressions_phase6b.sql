-- ============================================================
-- PHASE 6b — Rework confirm/correct support
-- Apply in the Supabase SQL editor BEFORE the confirm/correct UI ships.
-- DDL only; additive and idempotent (IF NOT EXISTS throughout).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ai_rework_suppressions: the "Normal, don't flag again" learning store.
--    No existing learned-pattern table fits: part_routing_patterns is FORWARD
--    routing confidence (reusing it would teach the auto-router to route parts
--    backward), and craftsman_classifications is unit classification. So this is a
--    dedicated, minimal store. Keyed per (tenant, from_dept, to_dept,
--    part_name_pattern) — the same normalized part-name pattern the routing learner
--    uses (lib/partNamePattern.patternFromPartName), so a recut of a DIFFERENT part
--    on the same route still flags.
CREATE TABLE IF NOT EXISTS ai_rework_suppressions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  from_dept         text        NOT NULL,
  to_dept           text        NOT NULL,
  part_name_pattern text        NOT NULL,
  created_by        text,                       -- supervisor who marked it normal
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, from_dept, to_dept, part_name_pattern)
);

CREATE INDEX IF NOT EXISTS idx_ai_rework_suppressions_lookup
  ON ai_rework_suppressions (tenant_id, from_dept, to_dept);

ALTER TABLE ai_rework_suppressions ENABLE ROW LEVEL SECURITY;
-- tenant_isolation from the start (the detector reads via the service role; the
-- supervisor UI reads/writes its OWN tenant only).
-- RLS retrofitted to anon-open in migration 20260702000000 (this tenant_isolation policy is NOT the live state).
CREATE POLICY "tenant_isolation" ON public.ai_rework_suppressions
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 2. ai_rework_events: store the normalized part_name_pattern at detection time so
--    the suppression CHECK (detector) and the suppression WRITE (UI "don't flag
--    again") use the identical value — no normalization drift between them.
ALTER TABLE ai_rework_events ADD COLUMN IF NOT EXISTS part_name_pattern text;

-- ─────────────────────────────────────────────────────────────
-- 3. damage_reports: distinguish supervisor-logged rework + carry its defect
--    category. report_type STAYS 'damage' (so these rows still appear in the
--    existing damage Reports list/filters); these two columns add the new facets.
--    rework_category ∈ damaged | wrong_dimensions | wrong_hole_placement | other.
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS logged_by_role  text;  -- 'supervisor' for rework "Log it"
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS rework_category text;
