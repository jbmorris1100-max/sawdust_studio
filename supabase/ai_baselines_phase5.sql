-- ============================================================
-- PHASE 5 — Baseline calculation engine schema
-- Apply in the Supabase SQL editor BEFORE the recompute engine writes.
-- DDL only; no data is moved. Idempotent (IF NOT EXISTS throughout).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ai_baselines: add tenant scoping.
--    The base table (supabase/ai_tables.sql) has no tenant_id, so baselines
--    would blend every shop together. Add it, then enforce one baseline per
--    (tenant, stage, job_type).
ALTER TABLE ai_baselines ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- job_type is NULL for now (stage-only baselines — there is no real job-type
-- classifier yet; see the engine docs). Postgres treats NULLs as DISTINCT, so a
-- plain UNIQUE (tenant_id, stage, job_type) would allow unlimited
-- (tenant, stage, NULL) duplicates. This DB is PG14 (no NULLS NOT DISTINCT), so
-- fold NULL -> '' via COALESCE in the index expression — same pattern the
-- craftsman_classifications learner uses.
CREATE UNIQUE INDEX IF NOT EXISTS ai_baselines_tenant_stage_jobtype_key
  ON ai_baselines (tenant_id, stage, COALESCE(job_type, ''));

CREATE INDEX IF NOT EXISTS idx_ai_baselines_tenant ON ai_baselines (tenant_id);

-- 1b. Tenant-scope ai_baselines' RLS. The base table (supabase/ai_tables.sql)
--     shipped WIDE-OPEN `using (true)` policies — every shop could read/write
--     every other shop's baselines (same cross-tenant bug class as the
--     departments / push_subscriptions RLS gaps fixed earlier). tenant_id only
--     exists as of this migration, so the tenant-scoped policy can only be
--     installed here. Drop the four permissive policies, install the standard
--     tenant_isolation pattern (engine still writes via the service role, which
--     bypasses RLS; the supervisor UI then reads its OWN tenant only).
DROP POLICY IF EXISTS "anon can read ai_baselines"   ON ai_baselines;
DROP POLICY IF EXISTS "anon can insert ai_baselines" ON ai_baselines;
DROP POLICY IF EXISTS "anon can update ai_baselines" ON ai_baselines;
DROP POLICY IF EXISTS "anon can delete ai_baselines" ON ai_baselines;
DROP POLICY IF EXISTS "tenant_isolation"             ON ai_baselines;
-- RLS retrofitted to anon-open in migration 20260702000000 (this tenant_isolation policy is NOT the live state).
CREATE POLICY "tenant_isolation" ON public.ai_baselines
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────
-- 2. ai_crew_pace: per-crew-member pace per stage.
--    Mirrors ai_baselines but keyed by worker. avg_hours here is the wall-clock
--    DWELL of the stage attributed to the worker who completed the transition —
--    it INCLUDES queue/idle time and is NOT a measure of active labor speed.
--    Any UI surfacing this must keep that distinction (see engine docs).
CREATE TABLE IF NOT EXISTS ai_crew_pace (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  worker_name    text        NOT NULL,
  stage          text        NOT NULL,
  job_type       text,                         -- NULL for now; reserved for future segmentation
  avg_hours      numeric(8,4),
  std_deviation  numeric(8,4),
  sample_count   integer     NOT NULL DEFAULT 0,
  calculated_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One pace row per (tenant, worker, stage, job_type); same COALESCE NULL-fold.
CREATE UNIQUE INDEX IF NOT EXISTS ai_crew_pace_tenant_worker_stage_key
  ON ai_crew_pace (tenant_id, worker_name, stage, COALESCE(job_type, ''));

CREATE INDEX IF NOT EXISTS idx_ai_crew_pace_tenant ON ai_crew_pace (tenant_id, stage);

ALTER TABLE ai_crew_pace ENABLE ROW LEVEL SECURITY;
-- Tenant isolation from the start (matches part_dept_events / routing_rules /
-- sort_list / crew_active_projects). NOT the old wide-open `USING (true)` —
-- per-worker pace is exactly the kind of data that must never leak across shops.
-- The engine writes via the service role (bypasses RLS); the supervisor UI reads
-- only its OWN tenant's rows.
-- RLS retrofitted to anon-open in migration 20260702000000 (this tenant_isolation policy is NOT the live state).
CREATE POLICY "tenant_isolation" ON public.ai_crew_pace
  USING (tenant_id = (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));
