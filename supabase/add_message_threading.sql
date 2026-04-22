-- ============================================================
-- Add to_name column to messages for conversation threading
-- Supervisor replies set to_name = crew member's sender_name
-- NULL = broadcast (standup posts, QC results, etc.)
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================
alter table messages add column if not exists to_name text;
create index if not exists idx_messages_to_name on messages (to_name);
