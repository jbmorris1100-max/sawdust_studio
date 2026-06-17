-- QC Delegation system
-- Lets a supervisor hand QC sign-off to a named crew member, gated by a PIN.
-- A delegate authenticates at /join?role=qc, then inspects cabinets from the
-- crew app (?qc=1) and passes/fails them. qc_by / qc_at record who signed off.

CREATE TABLE IF NOT EXISTS qc_delegates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  crew_member_name text NOT NULL,
  dept text,
  pin text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS qc_delegates_tenant_idx ON qc_delegates (tenant_id);

ALTER TABLE cabinet_units
  ADD COLUMN IF NOT EXISTS qc_by text,
  ADD COLUMN IF NOT EXISTS qc_at timestamptz;

-- RLS — crew/QC delegates hit Supabase with the anon key (no auth session), so
-- these policies mirror the open-to-public pattern the rest of the crew tables use.
ALTER TABLE qc_delegates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can read qc_delegates" ON qc_delegates;
CREATE POLICY "anon can read qc_delegates" ON qc_delegates FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "anon can insert qc_delegates" ON qc_delegates;
CREATE POLICY "anon can insert qc_delegates" ON qc_delegates FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "anon can update qc_delegates" ON qc_delegates;
CREATE POLICY "anon can update qc_delegates" ON qc_delegates FOR UPDATE TO public USING (true) WITH CHECK (true);
