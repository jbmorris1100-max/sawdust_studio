-- ============================================================
-- Clock-in / Clock-out adjustment requests
--
-- When a crew member clocks in/out at a time OTHER than "now", we don't write
-- to time_clock directly — we file a request the supervisor approves or denies.
-- These requests piggy-back on the existing messages table (no new table):
--
--   topic   = 'clock_in_request' | 'clock_out_request'
--   payload = {
--     requested_time: ISO string,   -- the time the crew wants recorded
--     reason:        string,        -- why it differs from now
--     worker_name:   string,
--     dept:          string,
--     status:       'pending' | 'approved' | 'denied',
--     shift_id:      uuid | null,   -- open time_clock row (clock-out only)
--     clock_in:      ISO | null     -- shift start (clock-out total-hours calc)
--   }
--
-- topic-tagged messages are action items, NOT chat — they never count toward the
-- unread message badge on either side.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS topic   text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS payload jsonb;

-- Fast lookup of open requests per tenant.
CREATE INDEX IF NOT EXISTS idx_messages_topic
  ON messages (tenant_id, topic)
  WHERE topic IS NOT NULL;
