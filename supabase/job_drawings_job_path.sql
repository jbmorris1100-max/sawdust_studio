-- ============================================================
-- Plans grouping — denormalize job_path onto job_drawings
-- Lets every uploaded file carry its job's "Client/Room" path so
-- the Plans list groups consistently regardless of how the job was
-- named. Backfills from the jobs table by job_number. Safe to re-run.
-- ============================================================

ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_path text;

-- Backfill existing drawings from their matching job (same tenant + job_number).
UPDATE job_drawings d
   SET job_path = j.job_path
  FROM jobs j
 WHERE d.job_path IS NULL
   AND d.tenant_id  = j.tenant_id
   AND d.job_number = j.job_number
   AND j.job_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_drawings_tenant_job_path
  ON job_drawings (tenant_id, job_path)
  WHERE job_path IS NOT NULL;
