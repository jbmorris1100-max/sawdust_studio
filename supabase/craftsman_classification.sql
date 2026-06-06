-- ============================================================
-- Craftsman Classification & Split Tickets
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Run AFTER assembly_tracking.sql (needs cabinet_units + parts).
-- ============================================================

-- 1. Department assignment + split-ticket lineage on cabinet_units
ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS assigned_dept text DEFAULT 'production';
  -- 'production' | 'assembly' | 'craftsman' | 'finishing' | 'split'

ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS parent_unit_id uuid;
  -- if this is a split ticket, references the original cabinet_unit

ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS is_split boolean DEFAULT false;
  -- true if this unit was created from / involved in a split

ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS split_from_id uuid;
  -- references the original unit this was split from

-- 2. Per-part department assignment
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS assigned_dept text;
  -- which dept is responsible for this part

-- 3. Craftsman classification learning
CREATE TABLE IF NOT EXISTS craftsman_classifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  unit_label_pattern text NOT NULL,
  -- key words that matched, e.g. "countertop", "shelf"
  part_name_pattern  text,
  -- specific part pattern if applicable
  assigned_dept      text NOT NULL,
  -- what dept this was assigned to
  confirmed_by       text,
  -- who confirmed / corrected this
  times_confirmed    integer DEFAULT 1,
  -- how many times this pattern was confirmed
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_craftsman_classifications_tenant
  ON craftsman_classifications (tenant_id, unit_label_pattern);

-- Helpful for split-group lookups on the supervisor side.
CREATE INDEX IF NOT EXISTS idx_cabinet_units_split_from
  ON cabinet_units (split_from_id);

ALTER TABLE craftsman_classifications ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "anon all craftsman_classifications"
    ON craftsman_classifications
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Realtime — supervisor sees splits + dept reassignments instantly
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE craftsman_classifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- (cabinet_units and parts are already in the publication from assembly_tracking.sql)
