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
-- Match the existing ai_* tables' permissive policies: the engine writes via the
-- service role (bypasses RLS); the supervisor UI reads. Tighten alongside the
-- other ai_* tables in a later security pass.
CREATE POLICY "anon can read ai_crew_pace"   ON ai_crew_pace FOR SELECT USING (true);
CREATE POLICY "anon can insert ai_crew_pace" ON ai_crew_pace FOR INSERT WITH CHECK (true);
CREATE POLICY "anon can update ai_crew_pace" ON ai_crew_pace FOR UPDATE USING (true);
CREATE POLICY "anon can delete ai_crew_pace" ON ai_crew_pace FOR DELETE USING (true);
