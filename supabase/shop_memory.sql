-- ============================================================
-- Part 3 — Shop Memory System
-- Stores learned CSV column mappings per file source on the tenant,
-- so a shop only maps a given file format once.
-- Run THIRD. Safe to run multiple times.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS file_formats jsonb DEFAULT '{}';
-- Example shape:
-- {
--   "cabinet_vision": {
--     "cabinet_unit_id": "Cabinet Number",
--     "part_name": "Part Name",
--     "room": "Room",
--     "material": "Material",
--     "width": "Width",
--     "height": "Height",
--     "depth": "Depth"
--   },
--   "custom_a1b2c3": { "cabinet_unit_id": "Cab #", "part_name": "Part Desc" }
-- }

-- Ensure existing tenants have a non-null default to merge into.
UPDATE tenants SET file_formats = '{}'::jsonb WHERE file_formats IS NULL;
