-- Capture material + labor estimates at job creation (Plans tab "Create new job"),
-- editable later from the Overview expanded job row.
-- material_est: dollars (numeric, no currency conversion logic here).
-- labor_est: HOURS, not dollars. Comparing against actual cost via
-- crew_members.hourly_rate is future work.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS material_est numeric;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS labor_est numeric;
