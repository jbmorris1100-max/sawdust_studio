-- ============================================================
-- Multi-Tenancy Hardening
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- 1. Adds tenant_id to device_tokens (was missing, causing a
--    cross-tenant data exposure when updating crew dept by name)
-- 2. Strengthens INSERT RLS on tables where tenant_id was added
--    as a nullable column — now rejected at DB level if NULL
-- ============================================================

-- ── 1. device_tokens: add tenant_id ───────────────────────────
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS tenant_id text;

CREATE INDEX IF NOT EXISTS idx_device_tokens_tenant_name
  ON device_tokens (tenant_id, name);

-- Rebuild INSERT policy: still allow null tenant_id on INSERT
-- (older mobile app versions may not have tenant context yet).
-- Isolation is enforced at the UPDATE level via app code (.eq tenant_id).
DROP POLICY IF EXISTS "anon can insert device_tokens" ON device_tokens;
CREATE POLICY "anon can insert device_tokens"
  ON device_tokens FOR INSERT WITH CHECK (true);

-- ── 2. messages: require tenant_id on insert ──────────────────
DROP POLICY IF EXISTS "anon can insert messages" ON messages;
CREATE POLICY "anon can insert messages"
  ON messages FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- ── 3. inventory_needs: require tenant_id on insert ──────────
DROP POLICY IF EXISTS "anon can insert inventory_needs" ON inventory_needs;
CREATE POLICY "anon can insert inventory_needs"
  ON inventory_needs FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- ── 4. damage_reports: require tenant_id on insert ────────────
DROP POLICY IF EXISTS "anon can insert damage_reports" ON damage_reports;
CREATE POLICY "anon can insert damage_reports"
  ON damage_reports FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- ── 5. time_clock: require tenant_id on insert ────────────────
DROP POLICY IF EXISTS "anon can insert time_clock" ON time_clock;
CREATE POLICY "anon can insert time_clock"
  ON time_clock FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- ── 6. job_drawings: require tenant_id on insert ──────────────
-- (parts_log, jobs, ai_daily_logs, ai_autonomous_log already have
--  NOT NULL constraints on tenant_id — no policy change needed)
DROP POLICY IF EXISTS "anon can insert job_drawings" ON job_drawings;
CREATE POLICY "anon can insert job_drawings"
  ON job_drawings FOR INSERT WITH CHECK (tenant_id IS NOT NULL);

-- ── 7. add delete policy to job_drawings (supervisor uses it) ─
DROP POLICY IF EXISTS "anon can delete job_drawings" ON job_drawings;
CREATE POLICY "anon can delete job_drawings"
  ON job_drawings FOR DELETE USING (true);

-- ── 8. update policies on jobs / parts_log (supervisor deletes) ─
DROP POLICY IF EXISTS "anon all jobs"          ON jobs;
DROP POLICY IF EXISTS "anon can all parts_log" ON parts_log;

CREATE POLICY "anon can read jobs"   ON jobs FOR SELECT USING (true);
CREATE POLICY "anon can insert jobs" ON jobs FOR INSERT WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon can update jobs" ON jobs FOR UPDATE USING (true);
CREATE POLICY "anon can delete jobs" ON jobs FOR DELETE USING (true);

CREATE POLICY "anon can read parts_log"   ON parts_log FOR SELECT USING (true);
CREATE POLICY "anon can insert parts_log" ON parts_log FOR INSERT WITH CHECK (tenant_id IS NOT NULL);
CREATE POLICY "anon can update parts_log" ON parts_log FOR UPDATE USING (true);
CREATE POLICY "anon can delete parts_log" ON parts_log FOR DELETE USING (true);

-- ── 9. integration_waitlist: no tenant_id needed (public form) ─
-- Already created with anon ALL policy in erp_integrations.sql

-- ── Verification query (run after migration) ──────────────────
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, cmd;
