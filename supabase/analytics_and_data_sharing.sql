-- ============================================================
-- Analytics & Data Sharing
-- Run in: Supabase Dashboard → SQL Editor → New Query
--
-- 1. Adds ai_data_sharing opt-in columns to tenants
-- 2. Creates platform_analytics table (no tenant_id — fully anonymous)
-- 3. RLS policies for platform_analytics
-- ============================================================

-- ── 1. Tenants: data sharing opt-in ───────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS
  ai_data_sharing boolean DEFAULT false;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS
  ai_data_sharing_enabled_at timestamptz;

-- ── 2. platform_analytics table ───────────────────────────────
-- No tenant_id stored — data is fully anonymized before insert.
-- The API route (/app/api/analytics) is the trust boundary:
-- it checks ai_data_sharing, strips identifying info, then inserts.
CREATE TABLE IF NOT EXISTS platform_analytics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  -- Allowed payload keys: hours, dept, had_job, resolution_type,
  -- days_open, result, material_type, activity_type, category.
  -- NO job numbers, NO worker names, NO company names.
  payload     jsonb       NOT NULL DEFAULT '{}',
  shop_size   text        CHECK (shop_size IN ('small', 'medium', 'large')),
  industry    text        DEFAULT 'cabinet',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_analytics_event
  ON platform_analytics (event_type, created_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────
ALTER TABLE platform_analytics ENABLE ROW LEVEL SECURITY;

-- Public read: platform aggregate data is intentionally readable
-- (used for benchmarks in the AI brief with no tenant context)
DROP POLICY IF EXISTS "anon can read platform_analytics" ON platform_analytics;
CREATE POLICY "anon can read platform_analytics"
  ON platform_analytics FOR SELECT USING (true);

-- INSERT is restricted: only the service role key (used by the
-- /app/api/analytics server route) may insert rows.
-- No INSERT policy for anon — service role bypasses RLS entirely.

-- ── Verification ──────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'tenants'
--   AND column_name IN ('ai_data_sharing', 'ai_data_sharing_enabled_at');

-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename = 'platform_analytics';
