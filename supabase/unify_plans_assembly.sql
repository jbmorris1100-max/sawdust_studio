-- Unified Plans + Assembly system
-- Plans is the single source of truth for all uploaded files (PDFs + CSV cut lists).
-- Run in the Supabase SQL Editor. Safe to run multiple times.

-- 1. Dept routing + file metadata on job_drawings
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS departments jsonb   DEFAULT '["all"]';
-- stores array: ["all"] or ["Production","Assembly"] etc
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS file_type   text    DEFAULT 'pdf';
-- 'pdf' or 'csv'
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS parsed      boolean DEFAULT false;
-- true once a CSV has been parsed into cabinet_units + parts

-- 2. Storage bucket for unified plan uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-plans', 'job-plans', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Public Access job-plans"
  ON storage.objects FOR ALL
  USING (bucket_id = 'job-plans')
  WITH CHECK (bucket_id = 'job-plans');
