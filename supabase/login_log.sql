-- ============================================================
-- LOGIN LOG
-- Full audit trail of every crew and supervisor login
-- ============================================================
create table if not exists login_log (
  id            uuid        primary key default gen_random_uuid(),
  worker_name   text        not null,
  dept          text,
  role          text        not null,
  device_id     text        not null,
  logged_in_at  timestamptz not null default now(),
  app_version   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_login_log_worker    on login_log (worker_name);
create index if not exists idx_login_log_logged_in on login_log (logged_in_at desc);
create index if not exists idx_login_log_role      on login_log (role);
create index if not exists idx_login_log_device    on login_log (device_id);

alter table login_log enable row level security;

create policy "anon can read login_log"
  on login_log for select using (true);

create policy "anon can insert login_log"
  on login_log for insert with check (true);
