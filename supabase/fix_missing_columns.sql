-- ============================================================
-- Fix: Missing columns, realtime, and storage buckets
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── damage_reports: all missing columns ──────────────────────
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS archived         boolean     DEFAULT false;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS photo_url        text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS tenant_id        text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolution_type  text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolution_notes text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolved_by      text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolved_at      timestamptz;

-- ── time_clock: add missing columns + relax NOT NULL constraints ─
-- Schema had worker_name NOT NULL; app inserts employee_name — add it.
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS employee_name  text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS work_order_id  text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS job_name       text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS minutes_logged integer;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS sync_status    text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS tenant_id      text;

-- App code never supplies worker_name, date, or guaranteed clock_in/dept.
-- Drop NOT NULL so inserts don't silently fail.
ALTER TABLE time_clock ALTER COLUMN worker_name DROP NOT NULL;
ALTER TABLE time_clock ALTER COLUMN dept        DROP NOT NULL;
ALTER TABLE time_clock ALTER COLUMN clock_in    DROP NOT NULL;
ALTER TABLE time_clock ALTER COLUMN date        DROP NOT NULL;

-- ── inventory_needs: tenant_id (safe if already exists) ──────
ALTER TABLE inventory_needs ADD COLUMN IF NOT EXISTS tenant_id text;

-- ── messages: tenant_id ──────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id text;

-- ── part_scans: tenant_id ────────────────────────────────────
ALTER TABLE part_scans ADD COLUMN IF NOT EXISTS tenant_id text;

-- ── Enable realtime for time_clock ───────────────────────────
ALTER TABLE time_clock REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE time_clock;

-- ── Enable realtime for job_drawings ─────────────────────────
ALTER TABLE job_drawings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE job_drawings;

-- ── Storage bucket for damage photos ─────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('damage-photos', 'damage-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Public Access damage-photos"
  ON storage.objects FOR ALL
  USING (bucket_id = 'damage-photos')
  WITH CHECK (bucket_id = 'damage-photos');

-- ── RLS for damage_reports update (resolution fields) ────────
-- Already has anon update policy — no change needed.

-- ── RLS reminder for any tables you created after schema.sql ─
-- If job_drawings is missing anon policies, run add_job_drawings.sql
