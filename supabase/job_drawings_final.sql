-- ============================================================
-- Part 7.1 — job_drawings final confirmed column list
-- Adds job_path so files can be addressed by the universal path,
-- and guarantees every column the app references exists.
-- Run FOURTH (after job_path.sql). Safe to run multiple times.
-- ============================================================

-- Confirmed column list the app relies on:
--   id, job_id, job_name, job_number, label, file_url, file_name,
--   uploaded_by, created_at, tenant_id, plan_name, external_url,
--   departments, file_type, parsed, job_path
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_id       text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_name     text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_number   text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS label        text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS file_url     text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS file_name    text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS uploaded_by  text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS tenant_id    text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS plan_name    text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS external_url text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS departments  jsonb   DEFAULT '["all"]';
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS file_type    text    DEFAULT 'pdf';
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS parsed       boolean DEFAULT false;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_path     text;  -- "Client/Room"

CREATE INDEX IF NOT EXISTS idx_job_drawings_job_path
  ON job_drawings (tenant_id, job_path)
  WHERE job_path IS NOT NULL;

-- Backfill job_path from the parent job where we can match on job_number.
UPDATE job_drawings d
   SET job_path = j.job_path
  FROM jobs j
 WHERE d.job_path IS NULL
   AND j.job_path IS NOT NULL
   AND d.tenant_id = j.tenant_id
   AND d.job_number = j.job_number;
