-- ============================================================
-- PHASE 6 — Rework signal schema
-- Apply in the Supabase SQL editor BEFORE the detect-rework engine writes.
-- DDL only; no data is moved. Idempotent (IF NOT EXISTS throughout).
-- ============================================================
--
-- ai_rework_events: one row PER PART per rework occurrence (counted unit), with a
-- deterministic bounce_event_id that GROUPS the per-part rows of a single
-- occurrence so the supervisor UI can show one card per kickback while the metric
-- still sums per-part magnitude (a 12-part recut weighs 12, one prompt). See the
-- engine docs in website/lib/rework.ts for the full rationale.
--
-- SOURCES & STATUS
--   • qc_fail        : a part_dept_events row with from_dept='qc' moving BACKWARD
--                      (to a lower sort_order dept). Auto-confirmed.
--   • damage         : a damage_reports row (report_type='damage'). Auto-confirmed.
--                      damage_reports has NO cabinet/part FK (part_name is free
--                      text, job_id is an optional job number), so these rows carry
--                      cabinet_unit_id=NULL, part_id=NULL, job_number=job_id, and
--                      bounce_event_id='damage:<report.id>' (one report = one event).
--   • backward_bounce: any OTHER backward part_dept_events move (recut, mis-sort).
--                      status='pending' — does NOT count until a supervisor confirms.
--
-- "Backward" is per-tenant: sort_order(to_dept) < sort_order(from_dept), joined to
-- the departments table (not a hardcoded pipeline).

CREATE TABLE IF NOT EXISTS ai_rework_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  -- Deterministic cluster key. For bounces: cabinet_unit_id|from>to|occurred_at
  -- (the per-part rows of one QC fail share an identical created_at — one bulk
  -- INSERT, one transaction, constant now()). For damage: 'damage:<report.id>'.
  bounce_event_id text        NOT NULL,
  part_id         uuid,                       -- the counted unit; NULL for damage (no part_id in source)
  cabinet_unit_id uuid,                       -- NULL for damage (no cabinet FK in source)
  job_number      text,
  source          text        NOT NULL CHECK (source IN ('qc_fail','damage','backward_bounce')),
  from_dept       text,
  to_dept         text,
  occurred_at     timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('confirmed','pending','dismissed')),
  reclassified_as text,                       -- on correct: e.g. 'legitimate_reroute' (status -> dismissed)
  confirmed_by    text,
  confirmed_at    timestamptz,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Idempotent re-detection: one row per (tenant, occurrence, part). The detector is
-- INSERT-ONLY on this key — a re-run must NEVER reset a supervisor's
-- confirmed/dismissed decision back to pending. PG14 has no NULLS NOT DISTINCT, so
-- fold NULL part_id (damage) via COALESCE — same pattern as ai_baselines.
CREATE UNIQUE INDEX IF NOT EXISTS ai_rework_events_dedup
  ON ai_rework_events (tenant_id, bounce_event_id, COALESCE(part_id::text, ''));

CREATE INDEX IF NOT EXISTS idx_ai_rework_tenant_status ON ai_rework_events (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_rework_event        ON ai_rework_events (tenant_id, bounce_event_id);

ALTER TABLE ai_rework_events ENABLE ROW LEVEL SECURITY;
-- Tenant isolation from the start (NOT the wide-open `using(true)` that ai_baselines
-- / ai_crew_pace had to be retrofitted away from). Engine writes via the service
-- role (bypasses RLS); the supervisor UI reads/updates its OWN tenant only.
CREATE POLICY "tenant_isolation" ON public.ai_rework_events
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));
