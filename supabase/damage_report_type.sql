-- ============================================================
-- Damage reports: distinguish actual damage from change-order requests.
-- Run in: Supabase Dashboard → SQL Editor → New Query. Safe to re-run.
-- ============================================================

ALTER TABLE damage_reports
  ADD COLUMN IF NOT EXISTS report_type text DEFAULT 'damage';
  -- 'damage' or 'change_order'

-- Backfill any existing rows so the supervisor filter/badge has a value.
UPDATE damage_reports SET report_type = 'damage' WHERE report_type IS NULL;
