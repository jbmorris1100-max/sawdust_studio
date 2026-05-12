-- ERP integration columns on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS innergy_api_key   text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS innergy_subdomain text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integrations      jsonb DEFAULT '{}';

-- Integration waitlist (notify-me + requests)
CREATE TABLE IF NOT EXISTS integration_waitlist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text,
  erp_name   text,
  email      text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE integration_waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all integration_waitlist"
  ON integration_waitlist FOR ALL USING (true) WITH CHECK (true);

-- Source column on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source   text DEFAULT 'manual';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_data jsonb DEFAULT '{}';
