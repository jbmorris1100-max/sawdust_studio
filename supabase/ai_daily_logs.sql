-- AI daily supervisor check-in logs
CREATE TABLE IF NOT EXISTS ai_daily_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  supervisor_name text,
  responses       jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  date            date        NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_ai_daily_logs_tenant_date ON ai_daily_logs (tenant_id, date DESC);

ALTER TABLE ai_daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read ai_daily_logs"
  ON ai_daily_logs FOR SELECT USING (true);

CREATE POLICY "anon can insert ai_daily_logs"
  ON ai_daily_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "anon can update ai_daily_logs"
  ON ai_daily_logs FOR UPDATE USING (true);
