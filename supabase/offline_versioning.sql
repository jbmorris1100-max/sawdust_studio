-- ============================================================
-- Plan file versioning + crew view tracking
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── job_drawings versioning ─────────────────────────────────
-- version       : 1-based version number, bumped when a plan is replaced
-- superseded_by  : id of the newer version that replaced this record
-- is_current     : false once a newer version supersedes it
ALTER TABLE job_drawings
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE job_drawings
  ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE job_drawings
  ADD COLUMN IF NOT EXISTS is_current boolean DEFAULT true;

-- ── plan_views — records who has viewed each plan ───────────
CREATE TABLE IF NOT EXISTS plan_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  plan_id     uuid NOT NULL,
  viewer_name text NOT NULL,
  viewed_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_views_plan
  ON plan_views (plan_id, viewed_at DESC);

ALTER TABLE plan_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all plan_views" ON plan_views;
CREATE POLICY "anon all plan_views"
  ON plan_views FOR ALL
  USING (true) WITH CHECK (true);
