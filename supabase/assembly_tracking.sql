-- ============================================================
-- Assembly Parts & Cabinet Tracking
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- 1. Cabinet Units — one row per physical cabinet/unit
CREATE TABLE IF NOT EXISTS cabinet_units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL,
  job_id         uuid REFERENCES jobs(id) ON DELETE CASCADE,
  job_number     text,
  room_number    text,
  cabinet_number text,
  unit_label     text NOT NULL,
  status         text DEFAULT 'pending',
  -- pending | in_assembly | flagged | complete
  flagged_reason text,
  completed_at   timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- 2. Parts — one row per part in a cabinet unit
CREATE TABLE IF NOT EXISTS parts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  cabinet_unit_id uuid REFERENCES cabinet_units(id) ON DELETE CASCADE,
  job_number      text,
  part_name       text NOT NULL,
  material        text,
  width           numeric,
  height          numeric,
  depth           numeric,
  quantity        integer DEFAULT 1,
  status          text DEFAULT 'pending',
  -- pending | checked | damaged | missing | wrong_part
  checked_at      timestamptz,
  checked_by      text,
  flag_type       text,
  -- damaged | missing | wrong_part
  flag_notes      text,
  scan_value      text,
  -- raw scan string that matched this part
  created_at      timestamptz DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_cabinet_units_tenant_job
  ON cabinet_units (tenant_id, job_number);
CREATE INDEX IF NOT EXISTS idx_parts_cabinet_unit
  ON parts (cabinet_unit_id);
CREATE INDEX IF NOT EXISTS idx_parts_scan_value
  ON parts (scan_value);
CREATE INDEX IF NOT EXISTS idx_parts_tenant
  ON parts (tenant_id);

-- 4. Row Level Security
ALTER TABLE cabinet_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all cabinet_units" ON cabinet_units
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon all parts" ON parts
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Realtime — add these tables to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE cabinet_units;
ALTER PUBLICATION supabase_realtime ADD TABLE parts;

-- ============================================================
-- Extend damage_reports for assembly scan flags
-- Run AFTER the base assembly_tracking migrations above
-- ============================================================

ALTER TABLE damage_reports
  ADD COLUMN IF NOT EXISTS flag_type       text,
  ADD COLUMN IF NOT EXISTS cabinet_unit_id uuid,
  ADD COLUMN IF NOT EXISTS assembler_name  text;

-- Index for filtering by flag_type
CREATE INDEX IF NOT EXISTS idx_damage_reports_flag_type
  ON damage_reports (flag_type);
