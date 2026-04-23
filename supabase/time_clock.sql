-- ============================================================
-- TIME CLOCK
-- Tracks crew clock-in / clock-out for labor tracking
-- ============================================================
create table if not exists time_clock (
  id           uuid    primary key default gen_random_uuid(),
  worker_name  text    not null,
  dept         text    not null,
  clock_in     timestamptz not null,
  clock_out    timestamptz,
  date         date    not null,
  total_hours  numeric(8,4),
  created_at   timestamptz not null default now()
);

create index if not exists idx_time_clock_date        on time_clock (date desc);
create index if not exists idx_time_clock_worker      on time_clock (worker_name);
create index if not exists idx_time_clock_dept        on time_clock (dept);
create index if not exists idx_time_clock_clock_out   on time_clock (clock_out) where clock_out is null;

alter table time_clock enable row level security;

create policy "anon can read time_clock"
  on time_clock for select using (true);

create policy "anon can insert time_clock"
  on time_clock for insert with check (true);

create policy "anon can update time_clock"
  on time_clock for update using (true);

-- Enable real-time for this table in the Supabase dashboard:
-- Database → Replication → Supabase Realtime → enable for time_clock
