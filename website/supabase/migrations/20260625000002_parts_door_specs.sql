-- ============================================================
-- Phase 3B — door spec columns on parts
-- The door report (cut_list_detail) enriches the door parts already created
-- from the nest (Phase 3A) with richer specs. These columns hold the real
-- fields the door report actually carries: a shared style-block header
-- (style, edges, materials, hinge hardware, route pattern, pull) plus the
-- per-door size cells (finished / panel / rail / stile, kept verbatim) and
-- the per-door hinge SIDE (Left/Right/Pair/None). enrichDoorPartsFromReport
-- UPDATEs these on the matching door parts; it never inserts new parts.
-- Sizes are stored as text because the report prints them as "qty - W x H"
-- composites, not single numerics. Safe to re-run.
-- ============================================================

ALTER TABLE parts ADD COLUMN IF NOT EXISTS door_style            text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS outside_edge          text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS inside_edge           text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS panel_material        text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS stiles_rails_material text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS panel_profile         text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS hinge_type            text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS route_pattern         text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS pull                  text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS finished_size         text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS panel_size            text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS rail_size             text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS stile_size            text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS hinge_side            text;
