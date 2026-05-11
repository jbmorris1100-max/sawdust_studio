-- Add photo_url column to parts_log
-- (damage_reports.photo_url already exists)
ALTER TABLE parts_log ADD COLUMN IF NOT EXISTS photo_url text;

-- Create storage buckets (run in Supabase SQL Editor or Dashboard → Storage)
-- damage-photos bucket (may already exist — skip if so)
INSERT INTO storage.buckets (id, name, public)
VALUES ('damage-photos', 'damage-photos', true)
ON CONFLICT (id) DO NOTHING;

-- part-photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('part-photos', 'part-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: allow anonymous read + write (matches existing app pattern)
CREATE POLICY IF NOT EXISTS "anon can upload damage photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'damage-photos');

CREATE POLICY IF NOT EXISTS "anon can read damage photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'damage-photos');

CREATE POLICY IF NOT EXISTS "anon can upload part photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'part-photos');

CREATE POLICY IF NOT EXISTS "anon can read part photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'part-photos');
