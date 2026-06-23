-- ── Sort List queue ───────────────────────────────────────────────────────────
-- Backs the Learn-mode fallback for unit classification. Previously, when
-- classify-units could not match a cabinet unit to any routing_rule or learned
-- pattern, it fell through to an AI guess. In Learn mode that AI step is retired:
-- the unmatched unit is instead parked here as a flat queue entry (assigned_dept
-- on the unit itself is left null/unset), and a supervisor manually assigns it
-- from a new "Sort List" tab. That manual assignment feeds the learning system
-- (the table learnRouting() already writes to for confirmed pushes) so the same
-- kind of unit does not re-queue on the next upload.
--
-- This migration is schema only — the classify-units fallback change, the
-- supervisor Sort List tab, and the learn-on-assign wiring land later.
--
-- Shape: one row per unsorted unit. No grouping, no quantities, no status —
-- once a supervisor resolves an entry its row is DELETED, so the queue only ever
-- holds units still awaiting a department. (The resolved assignment is preserved
-- in the learning table, not here.)
--
-- Type notes (verified against live schema, matching the 20260619 department
-- templates migration which already corrected the same drift):
--   • tenant_id is uuid REFERENCES tenants(id) — the SQL files in this repo still
--     declare cabinet_units/parts.tenant_id as text, but the LIVE schema uses
--     uuid across tenant-scoped tables. Following the live convention here.
--   • cabinet_units.id is uuid (gen_random_uuid). FK with ON DELETE CASCADE so a
--     deleted/re-imported job cannot leave orphaned queue entries.
--   • job_number is text, denormalized from cabinet_units.job_number so the
--     supervisor tab can label entries without a join.

CREATE TABLE IF NOT EXISTS sort_list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cabinet_unit_id uuid NOT NULL REFERENCES cabinet_units(id) ON DELETE CASCADE,
  job_number      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A unit can sit in the queue at most once; lets the classify-units fallback
  -- insert with ON CONFLICT DO NOTHING so a re-run is idempotent.
  CONSTRAINT sort_list_unit_unique UNIQUE (cabinet_unit_id)
);

-- Supervisor tab reads the whole tenant queue oldest-first.
CREATE INDEX IF NOT EXISTS sort_list_tenant_idx ON sort_list (tenant_id, created_at);

-- ── Row-level security ──────────────────────────────────────────────────────
-- Every tenant-scoped table in this app carries the same owner-based isolation
-- policy (see routing_rules.sql / part_dept_events.sql). sort_list MUST too:
-- classify-units inserts here with the service-role key (which bypasses RLS),
-- but the supervisor's Sort List tab reads/deletes via the authenticated anon
-- client, so without this policy the tab is permanently empty and a queued unit
-- can never be assigned. Mirror the canonical "tenant_isolation" policy verbatim.
-- DROP-then-CREATE keeps this re-runnable on an already-applied table.
ALTER TABLE sort_list ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON sort_list;
CREATE POLICY "tenant_isolation" ON sort_list
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

-- ── Allow 'sort_list' as a department template ─────────────────────────────────
-- The 20260619 department_templates migration deliberately left 'sort_list' out
-- of the CHECK (it was deferred to this table migration). Re-create the named
-- constraint to add it. Drop-if-exists keeps this re-runnable.
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_template_check;
ALTER TABLE departments ADD CONSTRAINT departments_template_check
  CHECK (template IN ('part','cabinet','group_auto','group_manual','sheet','qc','sort_list'));
