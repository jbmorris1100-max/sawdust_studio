-- ============================================================
-- Message read-state — true unread counter for the supervisor
--
-- A message is "unread" when it came FROM crew (sender_name != 'Supervisor')
-- and the supervisor has not yet opened its thread (read_at IS NULL).
-- When the supervisor opens a thread, every crew message in that thread is
-- stamped with read_at = now(), which clears it from the unread count.
--
-- read_at is stored in Supabase (not localStorage) so the count persists
-- across devices and sessions. Realtime UPDATE events keep open dashboards
-- in sync the instant a thread is read.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
-- null = unread, timestamp = when the supervisor opened the thread

-- Speeds up the unread count (sender_name != 'Supervisor' AND read_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (tenant_id)
  WHERE read_at IS NULL;

-- Ensure messages broadcasts UPDATE events so the unread counter updates in
-- realtime when a thread is marked read. (No-op if already in the publication.)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
