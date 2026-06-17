-- Per-department feature config for custom departments
-- Lets a supervisor enable/disable individual features for departments they add
-- themselves (anything not in the fixed set Production/Assembly/Finishing/
-- Craftsman/QC). Shaped as:
--   { "<dept name lowercase>": {
--       "time_tracking": bool, "part_tracking": bool, "qc_access": bool,
--       "messaging": bool, "damage_reporting": bool, "inventory_logging": bool,
--       "view_plans": bool, "view_sops": bool
--     }, ... }
-- Nullable: fixed departments are never stored here and keep their existing
-- behavior. No crew screen consumes this yet — supervisor-side config storage only.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS dept_config jsonb;
