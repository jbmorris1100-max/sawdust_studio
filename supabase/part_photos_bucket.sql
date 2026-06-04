-- ============================================================
-- Production Handoff — proof-of-cut photo storage
-- Stores the photo a Production crew member captures when marking
-- parts cut (saved to parts.cut_photo_url, added in production_handoff.sql).
-- Run AFTER production_handoff.sql. Safe to run multiple times.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('part-photos', 'part-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY IF NOT EXISTS "Public Access part-photos"
  ON storage.objects FOR ALL
  USING (bucket_id = 'part-photos')
  WITH CHECK (bucket_id = 'part-photos');
