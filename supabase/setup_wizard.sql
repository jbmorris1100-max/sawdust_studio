-- ============================================================
-- First-time Setup Wizard — tenant flags
-- Tracks whether a shop has completed onboarding + which
-- departments it runs. Safe to run multiple times.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS setup_complete boolean DEFAULT false;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS departments jsonb DEFAULT '[]';

-- Existing shops with jobs or crew shouldn't be forced through onboarding.
UPDATE tenants t
   SET setup_complete = true
 WHERE COALESCE(setup_complete, false) = false
   AND (
     EXISTS (SELECT 1 FROM jobs j WHERE j.tenant_id = t.id::text)
     OR EXISTS (SELECT 1 FROM time_clock c WHERE c.tenant_id = t.id::text)
   );
