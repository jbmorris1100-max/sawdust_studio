-- ============================================================
-- SUPERVISOR SESSIONS
-- One active supervisor at a time across all devices
-- ============================================================
create table if not exists supervisor_sessions (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  device_id     text        not null,
  logged_in_at  timestamptz not null default now(),
  logged_out_at timestamptz,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_sup_sessions_active    on supervisor_sessions (is_active) where is_active = true;
create index if not exists idx_sup_sessions_device    on supervisor_sessions (device_id);
create index if not exists idx_sup_sessions_logged_in on supervisor_sessions (logged_in_at desc);

alter table supervisor_sessions enable row level security;

create policy "anon can read supervisor_sessions"
  on supervisor_sessions for select using (true);

create policy "anon can insert supervisor_sessions"
  on supervisor_sessions for insert with check (true);

create policy "anon can update supervisor_sessions"
  on supervisor_sessions for update using (true);

create policy "anon can delete supervisor_sessions"
  on supervisor_sessions for delete using (true);
