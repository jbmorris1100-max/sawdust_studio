-- ============================================================
-- Finishing Specs (per job) + finish-specs storage bucket
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS finish_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  job_number text NOT NULL,
  job_path text,
  -- Cabinet finish
  cabinet_color text,
  cabinet_finish text,        -- painted, stained, natural, glazed, other
  -- Doors
  door_style text,
  door_color text,
  door_finish text,
  -- Edge banding
  edge_banding_color text,
  edge_banding_type text,
  -- Paint
  paint_type text,            -- latex, oil, lacquer, etc
  sheen text,                 -- flat, satin, semi-gloss, gloss
  stain_color text,
  primer text,
  special_notes text,
  -- per-room overrides: { "Master Bath": { "cabinet_color": "Navy Blue" } }
  room_overrides jsonb DEFAULT '{}',
  spec_file_url text,         -- uploaded PDF/image if available
  spec_file_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finish_specs_tenant_job
  ON finish_specs (tenant_id, job_number);

ALTER TABLE finish_specs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "anon all finish_specs" ON finish_specs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Realtime so the finishing crew sees new/updated specs instantly.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE finish_specs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Storage bucket for uploaded finish-spec documents ──────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('finish-specs', 'finish-specs', true)
ON CONFLICT (id) DO NOTHING;

-- Public read + anon write (mirrors the app's other public buckets).
DO $$
BEGIN
  CREATE POLICY "finish-specs read" ON storage.objects
    FOR SELECT USING (bucket_id = 'finish-specs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "finish-specs write" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'finish-specs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "finish-specs update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'finish-specs');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
