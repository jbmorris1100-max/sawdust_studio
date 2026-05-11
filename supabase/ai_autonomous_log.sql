-- Autonomous AI action log
-- Records every action taken by the autonomous AI engine
CREATE TABLE IF NOT EXISTS ai_autonomous_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  action_type  text        NOT NULL,  -- 'auto_message' | 'damage_flag' | 'reorder_alert' | 'daily_summary'
  triggered_by text,                  -- description of what condition triggered this
  message_sent text,                  -- what was sent or generated
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_autonomous_log_tenant ON ai_autonomous_log (tenant_id, created_at DESC);

ALTER TABLE ai_autonomous_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read ai_autonomous_log"
  ON ai_autonomous_log FOR SELECT USING (true);

CREATE POLICY "anon can insert ai_autonomous_log"
  ON ai_autonomous_log FOR INSERT WITH CHECK (true);
