-- ============================================================
-- Part 4 — Production to Assembly Handoff
-- Adds a production status layer to parts so assembly only sees
-- cabinets whose parts are physically cut.
-- Run SECOND. Safe to run multiple times.
-- ============================================================

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS production_status text DEFAULT 'not_cut';
  -- not_cut | cutting | cut | qa_passed | in_assembly | complete

ALTER TABLE parts ADD COLUMN IF NOT EXISTS cut_by        text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS cut_at        timestamptz;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS cut_confirmed boolean DEFAULT false;

-- Optional proof-of-cut photo (matches camera button in Production flow)
ALTER TABLE parts ADD COLUMN IF NOT EXISTS cut_photo_url text;

-- Cabinet-level production rollup so assembly can filter quickly.
ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS production_status text DEFAULT 'not_cut';
  -- not_cut | cutting | cut | in_assembly | complete

CREATE INDEX IF NOT EXISTS idx_parts_production_status
  ON parts (tenant_id, production_status);
CREATE INDEX IF NOT EXISTS idx_cabinet_units_production_status
  ON cabinet_units (tenant_id, production_status);

-- Backfill: anything already checked/complete is treated as cut so the
-- existing data doesn't suddenly disappear from assembly queues.
UPDATE parts
   SET production_status = 'cut'
 WHERE production_status = 'not_cut'
   AND status IN ('checked', 'complete');
