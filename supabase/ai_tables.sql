-- ============================================================
-- AI LEARNING SYSTEM TABLES
-- Foundation for pattern recognition and scheduling assistance
-- ============================================================

-- Per-job-stage data points captured automatically
create table if not exists ai_learning_log (
  id                  uuid        primary key default gen_random_uuid(),
  job_id              text,
  job_type            text,
  stage               text,
  dept                text,
  hours_spent         numeric(8,4),
  crew_count          integer,
  concurrent_jobs     integer,
  day_of_week         integer,       -- 0=Sun … 6=Sat
  hour_of_day         integer,       -- 0–23
  had_damage          boolean        default false,
  had_qc_fail         boolean        default false,
  had_material_delay  boolean        default false,
  supervisor_notes    text,
  date                date,
  created_at          timestamptz    not null default now()
);

create index if not exists idx_ai_log_date  on ai_learning_log (date desc);
create index if not exists idx_ai_log_stage on ai_learning_log (stage);
create index if not exists idx_ai_log_job   on ai_learning_log (job_id);

alter table ai_learning_log enable row level security;
create policy "anon can read ai_learning_log"   on ai_learning_log for select using (true);
create policy "anon can insert ai_learning_log" on ai_learning_log for insert with check (true);
create policy "anon can update ai_learning_log" on ai_learning_log for update using (true);
create policy "anon can delete ai_learning_log" on ai_learning_log for delete using (true);

-- ─────────────────────────────────────────────────────────────

-- Supervisor end-of-shift assessment (2 min daily form)
create table if not exists ai_daily_input (
  id               uuid        primary key default gen_random_uuid(),
  date             date        not null,
  supervisor_name  text,
  bottlenecks      text,         -- JSON array of selected strings
  external_factors text,
  output_rating    integer     check (output_rating between 1 and 5),
  notes            text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ai_daily_date on ai_daily_input (date desc);

alter table ai_daily_input enable row level security;
create policy "anon can read ai_daily_input"   on ai_daily_input for select using (true);
create policy "anon can insert ai_daily_input" on ai_daily_input for insert with check (true);
create policy "anon can update ai_daily_input" on ai_daily_input for update using (true);
create policy "anon can delete ai_daily_input" on ai_daily_input for delete using (true);

-- ─────────────────────────────────────────────────────────────

-- Calculated performance benchmarks (populated after 45-day window)
create table if not exists ai_baselines (
  id             uuid        primary key default gen_random_uuid(),
  stage          text        not null,
  job_type       text,
  avg_hours      numeric(8,4),
  std_deviation  numeric(8,4),
  sample_count   integer     default 0,
  calculated_at  timestamptz,
  created_at     timestamptz not null default now()
);

alter table ai_baselines enable row level security;
create policy "anon can read ai_baselines"   on ai_baselines for select using (true);
create policy "anon can insert ai_baselines" on ai_baselines for insert with check (true);
create policy "anon can update ai_baselines" on ai_baselines for update using (true);
create policy "anon can delete ai_baselines" on ai_baselines for delete using (true);

-- ─────────────────────────────────────────────────────────────

-- Mode and feature-toggle configuration (single row, upserted on first use)
create table if not exists ai_settings (
  id                        uuid        primary key default gen_random_uuid(),
  mode                      text        not null default 'observation'
                              check (mode in ('observation','assist','autonomous')),
  learning_active           boolean     not null default true,
  daily_standup_active      boolean     not null default false,
  bottleneck_alerts_active  boolean     not null default false,
  cost_forecasting_active   boolean     not null default false,
  crew_scheduling_active    boolean     not null default false,
  inventory_patterns_active boolean     not null default false,
  qc_failure_alerts_active  boolean     not null default false,
  updated_by                text,
  updated_at                timestamptz not null default now()
);

alter table ai_settings enable row level security;
create policy "anon can read ai_settings"   on ai_settings for select using (true);
create policy "anon can insert ai_settings" on ai_settings for insert with check (true);
create policy "anon can update ai_settings" on ai_settings for update using (true);

-- Seed default row (run once)
insert into ai_settings (mode, learning_active)
  values ('observation', true);
