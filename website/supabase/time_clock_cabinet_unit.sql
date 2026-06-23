-- Run this in Supabase SQL Editor before deploying.
--
-- Links a time_clock session to the cabinet it was worked on, so the QC views
-- can show real per-cabinet active time (gated by a human Start/Pause/Resume)
-- for Craftsman and Assembly, instead of raw part_dept_events dwell time.
--
-- Nullable on purpose: Finishing tracks time per ROOM (a room can span multiple
-- cabinets painted together), never per cabinet, so every row Finishing writes
-- leaves this column null. That is intentional, not a bug.

ALTER TABLE public.time_clock ADD COLUMN IF NOT EXISTS cabinet_unit_id uuid;
