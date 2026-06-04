-- ============================================================
-- Part 1 + Part 6 — Job Identifier System + Due Dates / Timeline
-- Adds the universal "Client/Room" job_path plus scheduling fields.
-- Run FIRST. Safe to run multiple times.
-- ============================================================

-- ── New columns on jobs ──────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_path     text;  -- "Client/Room" e.g. "Smith/Kitchen"
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_name  text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS room_name    text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS due_date     date;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS install_date date;

-- ── Backfill job_path / client_name / room_name for existing rows ──
-- Best-effort: derive a path from job_name when client/room not set.
UPDATE jobs
   SET client_name = COALESCE(client_name, job_name),
       room_name   = COALESCE(room_name, '')
 WHERE client_name IS NULL;

UPDATE jobs
   SET job_path = NULLIF(
         trim(both '/' FROM
           COALESCE(client_name, job_name, '') ||
           CASE WHEN COALESCE(room_name, '') <> '' THEN '/' || room_name ELSE '' END
         ), '')
 WHERE job_path IS NULL;

-- ── Uniqueness: job_path is unique PER TENANT ────────────────
-- Partial unique index ignores NULL paths. Case-insensitive match
-- so "Smith/Kitchen" and "smith/kitchen" collide as intended.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_tenant_job_path
  ON jobs (tenant_id, lower(job_path))
  WHERE job_path IS NOT NULL;

-- Lookup index for due-date driven dashboards
CREATE INDEX IF NOT EXISTS idx_jobs_due_date
  ON jobs (tenant_id, due_date)
  WHERE due_date IS NOT NULL;
