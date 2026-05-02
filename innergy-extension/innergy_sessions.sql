-- Run this in Supabase SQL editor → https://supabase.com/dashboard/project/suwadpgtqifwufmlwhpk/sql

CREATE TABLE IF NOT EXISTS innergy_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          text        NOT NULL,
  event_type          text        NOT NULL,
  page_url            text,
  page_route          text,
  page_title          text,
  visible_jobs        jsonb,
  visible_work_orders jsonb,
  visible_data        jsonb,
  click_target        text,
  time_on_page        integer,
  timestamp           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE innergy_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all" ON innergy_sessions
  USING (true)
  WITH CHECK (true);

-- Optional: index for querying by session or event type
CREATE INDEX IF NOT EXISTS idx_innergy_sessions_session_id  ON innergy_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_innergy_sessions_event_type  ON innergy_sessions (event_type);
CREATE INDEX IF NOT EXISTS idx_innergy_sessions_created_at  ON innergy_sessions (created_at DESC);
