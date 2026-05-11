-- Add tenant_id to sops (required for per-tenant filtering)
ALTER TABLE sops ADD COLUMN IF NOT EXISTS tenant_id text;

-- Allow NULL dept on sops (so "All Departments" SOPs have dept = NULL)
ALTER TABLE sops ALTER COLUMN dept DROP NOT NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sops_tenant ON sops (tenant_id);

-- Storage bucket: job-plans (for supervisor plan uploads)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('job-plans', 'job-plans', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage bucket: sop-files (for supervisor SOP PDF uploads)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('sop-files', 'sop-files', true)
  ON CONFLICT (id) DO NOTHING;

-- Public read/write policy for job-plans bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Access job-plans' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Public Access job-plans" ON storage.objects
      FOR ALL USING (bucket_id = 'job-plans')
      WITH CHECK (bucket_id = 'job-plans');
  END IF;
END $$;

-- Public read/write policy for sop-files bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public Access sop-files' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Public Access sop-files" ON storage.objects
      FOR ALL USING (bucket_id = 'sop-files')
      WITH CHECK (bucket_id = 'sop-files');
  END IF;
END $$;
