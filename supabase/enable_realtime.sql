-- ============================================================
-- Enable Supabase Realtime + REPLICA IDENTITY FULL
--
-- Without this, postgres_changes subscriptions receive nothing
-- even when the client-side .on('postgres_changes'...) is set up
-- correctly. Tables must be explicitly added to the publication.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- REPLICA IDENTITY FULL ensures the complete row is included in
-- every change event. Without it, UPDATE/DELETE payloads are
-- partial and INSERT latency can be higher on busy tables.
alter table messages         replica identity full;
alter table inventory_needs  replica identity full;
alter table damage_reports   replica identity full;
alter table part_scans       replica identity full;

-- Add all four tables to the supabase_realtime publication.
-- This is the step most commonly missed — the subscription
-- silently receives nothing until the table is listed here.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table inventory_needs;
alter publication supabase_realtime add table damage_reports;
alter publication supabase_realtime add table part_scans;
