-- Craftsman build timer and material log support
-- ─────────────────────────────────────────────────────────────────────────────

-- time_clock: add status, job_number, notes (craftsman build timer)
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS status     text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS job_number text;
ALTER TABLE time_clock ADD COLUMN IF NOT EXISTS notes      text;

-- inventory_needs: add notes column
ALTER TABLE inventory_needs ADD COLUMN IF NOT EXISTS notes text;

-- inventory_needs: expand status check to allow 'craftsman_material'
-- (Postgres auto-names inline check constraints as {table}_{column}_check)
DO $$
BEGIN
  ALTER TABLE inventory_needs DROP CONSTRAINT IF EXISTS inventory_needs_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE inventory_needs ADD CONSTRAINT inventory_needs_status_check
  CHECK (status IN ('pending', 'ordered', 'received', 'cancelled', 'craftsman_material'));

-- Index for fast craftsman build queries
CREATE INDEX IF NOT EXISTS idx_time_clock_status ON time_clock (status, tenant_id);
