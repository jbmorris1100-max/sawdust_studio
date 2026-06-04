-- ============================================================
-- Crew Management
-- Per-tenant roster of crew members surfaced in the supervisor
-- dashboard Crew tab. Crew are auto-registered on first clock-in
-- and can also be added manually.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS crew_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  name        text NOT NULL,
  department  text,
  role        text DEFAULT 'crew',     -- crew, lead, supervisor
  status      text DEFAULT 'active',   -- active, inactive
  joined_at   timestamptz DEFAULT now(),
  last_active timestamptz,
  notes       text
);

CREATE INDEX IF NOT EXISTS idx_crew_members_tenant
  ON crew_members (tenant_id, status);

ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all crew_members" ON crew_members;
CREATE POLICY "anon all crew_members"
  ON crew_members
  FOR ALL USING (true) WITH CHECK (true);

-- Link a clock-in row to its crew member (best-effort; nullable).
ALTER TABLE time_clock
  ADD COLUMN IF NOT EXISTS crew_member_id uuid;

-- ── Realtime ────────────────────────────────────────────────
-- Required so the Crew tab list updates live as crew clock in.
ALTER TABLE crew_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE crew_members;
