-- ============================================================
-- Web Push subscriptions
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  user_type   text NOT NULL,            -- 'supervisor' or 'crew'
  user_name   text,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant
  ON push_subscriptions (tenant_id, user_type);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon all push_subscriptions" ON push_subscriptions;
CREATE POLICY "anon all push_subscriptions"
  ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);
