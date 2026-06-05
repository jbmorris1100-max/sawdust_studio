-- ============================================================================
-- pre_stripe_features.sql
-- Job completion + archive, notification center, and AI label-mapping tables.
-- Idempotent — safe to run multiple times.
-- Run order: this single file covers all three migrations.
-- ============================================================================

-- ── Feature 1: Job completion + archive ─────────────────────────────────────
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- cabinet_units already carry status; ensure completed_at exists for archive view.
ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ── Feature 2: Notification center ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  target_type text NOT NULL,            -- 'supervisor' | 'crew' | 'all'
  dept text,
  title text NOT NULL,
  body text NOT NULL,
  url text,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON notifications (tenant_id, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon all notifications" ON notifications;
CREATE POLICY "anon all notifications"
  ON notifications FOR ALL
  USING (true) WITH CHECK (true);

-- ── Feature 4: AI label mappings (shop learning) ────────────────────────────
CREATE TABLE IF NOT EXISTS label_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  raw_label text NOT NULL,              -- what crew scanned/typed (stored lowercase)
  matched_part_name text NOT NULL,      -- what it mapped to
  cabinet_unit_id uuid,
  job_number text,
  confidence numeric(5,2),
  confirmed_by text,                    -- worker who confirmed the match
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_label_mappings_tenant
  ON label_mappings (tenant_id, raw_label);
ALTER TABLE label_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon all label_mappings" ON label_mappings;
CREATE POLICY "anon all label_mappings"
  ON label_mappings FOR ALL
  USING (true) WITH CHECK (true);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Enable realtime broadcasts for the notification bell (ignore if already added).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
