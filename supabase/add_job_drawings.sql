-- Create job_drawings table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS job_drawings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text,
  job_id       text,
  job_number   text,
  job_name     text,
  plan_name    text,
  label        text,
  file_url     text,
  external_url text,
  file_name    text,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);

-- Add new columns to existing table (safe if table already exists)
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS tenant_id    text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS job_number   text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS plan_name    text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS external_url text;

-- RLS
ALTER TABLE job_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "anon can read job_drawings"
  ON job_drawings FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "anon can insert job_drawings"
  ON job_drawings FOR INSERT WITH CHECK (true);

-- Storage bucket for job plan PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-drawings', 'job-drawings', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read/write on the bucket (anon key usage)
CREATE POLICY IF NOT EXISTS "Public Access job-drawings"
  ON storage.objects FOR ALL
  USING (bucket_id = 'job-drawings')
  WITH CHECK (bucket_id = 'job-drawings');
