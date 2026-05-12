CREATE TABLE IF NOT EXISTS jobs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text        NOT NULL,
  job_number  text        NOT NULL,
  job_name    text,
  status      text        NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant
  ON jobs (tenant_id, created_at DESC);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all jobs"
  ON jobs FOR ALL USING (true) WITH CHECK (true);
