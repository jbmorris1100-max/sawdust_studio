-- ============================================================
-- Shift Activity Tracking
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. shift_events table
CREATE TABLE IF NOT EXISTS shift_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL,
  time_clock_id  uuid REFERENCES time_clock(id) ON DELETE CASCADE,
  worker_name    text NOT NULL,
  event_type     text NOT NULL,
  -- clock_in, clock_out, dept_switch, break_start, break_end,
  -- part_scanned, inventory_logged, damage_reported, message_sent
  dept           text,
  previous_dept  text,
  metadata       jsonb DEFAULT '{}',
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_events_time_clock
  ON shift_events (time_clock_id);
CREATE INDEX IF NOT EXISTS idx_shift_events_tenant_worker
  ON shift_events (tenant_id, worker_name, created_at DESC);

ALTER TABLE shift_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all shift_events" ON shift_events
  FOR ALL USING (true) WITH CHECK (true);

-- Add to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE shift_events;

-- 2. Break tracking columns on time_clock
ALTER TABLE time_clock
  ADD COLUMN IF NOT EXISTS break_start           timestamptz,
  ADD COLUMN IF NOT EXISTS break_end             timestamptz,
  ADD COLUMN IF NOT EXISTS total_break_minutes   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_dept          text,
  ADD COLUMN IF NOT EXISTS on_break              boolean DEFAULT false;
