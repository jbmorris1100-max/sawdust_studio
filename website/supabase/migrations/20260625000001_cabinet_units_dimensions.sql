-- ============================================================
-- Phase 2 — dimension columns on cabinet_units
-- The cabinet-roster import (parse-file mode 'extract-cabinet-roster'
-- → seedCabinetUnitsFromRoster) extracts per-cabinet dimensions, but
-- cabinet_units only has the core identity columns. Without these,
-- the "full" insert fails and the code falls back to core columns,
-- silently dropping width/height/depth/lr/quantity on every import.
-- Adding them lets the full insert succeed and persist dimensions.
-- Safe to re-run.
-- ============================================================

ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS cabinet_name text;
ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS width        numeric;
ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS height       numeric;
ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS depth        numeric;
ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS lr           text;
ALTER TABLE cabinet_units ADD COLUMN IF NOT EXISTS quantity     integer;
