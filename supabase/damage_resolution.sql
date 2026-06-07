ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolution_type   text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolution_notes  text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolved_by       text;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolution_cost   numeric;
ALTER TABLE damage_reports ADD COLUMN IF NOT EXISTS resolved_at       timestamptz;
