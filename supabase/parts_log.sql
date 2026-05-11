CREATE TABLE IF NOT EXISTS parts_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text        NOT NULL,
  worker_name text,
  job_number  text,
  part_name   text        NOT NULL,
  dept        text,
  status      text        NOT NULL DEFAULT 'In Progress',
  next_dept   text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_log_tenant
  ON parts_log (tenant_id, created_at DESC);

ALTER TABLE parts_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can all parts_log"
  ON parts_log FOR ALL USING (true) WITH CHECK (true);
