-- ============================================================
-- Ensure the job-plans bucket accepts ALL file types
-- The bucket is created without allowed_mime_types (= NULL = no
-- restriction), but this makes it explicit and clears any limit
-- that may have been set later from the dashboard.
-- Run in: Supabase Dashboard → SQL Editor → New Query. Idempotent.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('job-plans', 'job-plans', true)
ON CONFLICT (id) DO NOTHING;

-- NULL allowed_mime_types = accept every file type
-- (PDF, CSV, SVG, HTML, DXF, XML, XLSX/XLS, JPG/JPEG/PNG/WEBP, …).
UPDATE storage.buckets
   SET allowed_mime_types = NULL
 WHERE id = 'job-plans';
