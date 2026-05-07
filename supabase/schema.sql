-- ============================================================
-- Sawdust Crew - Shop Floor App Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ============================================================
-- MESSAGES
-- Shop floor communication between departments
-- ============================================================
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  sender_name text        not null,
  dept        text        not null,
  body        text        not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- INVENTORY NEEDS
-- Tracks parts/materials requested by dept or job
-- ============================================================
create table if not exists inventory_needs (
  id         uuid primary key default gen_random_uuid(),
  item       text        not null,
  dept       text        not null,
  job_id     text,
  job_number text,
  qty        integer     not null default 1 check (qty > 0),
  status     text        not null default 'pending'
               check (status in ('pending', 'ordered', 'received', 'cancelled')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- DAMAGE REPORTS
-- Documents damaged parts tied to a job
-- ============================================================
create table if not exists damage_reports (
  id         uuid primary key default gen_random_uuid(),
  part_name  text        not null,
  job_id     text,
  dept       text        not null,
  notes      text,
  status     text        not null default 'open'
               check (status in ('open', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- PART SCANS
-- Barcode/QR scan log from the shop floor
-- ============================================================
create table if not exists part_scans (
  id          uuid primary key default gen_random_uuid(),
  part_num    text        not null,
  job_id      text,
  dept        text        not null,
  scanned_by  text        not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_messages_dept         on messages (dept);
create index if not exists idx_messages_created_at   on messages (created_at desc);

create index if not exists idx_inventory_needs_dept      on inventory_needs (dept);
create index if not exists idx_inventory_needs_job_id    on inventory_needs (job_id);
create index if not exists idx_inventory_needs_status    on inventory_needs (status);

create index if not exists idx_damage_reports_dept      on damage_reports (dept);
create index if not exists idx_damage_reports_job_id    on damage_reports (job_id);
create index if not exists idx_damage_reports_status    on damage_reports (status);

create index if not exists idx_part_scans_part_num   on part_scans (part_num);
create index if not exists idx_part_scans_job_id     on part_scans (job_id);
create index if not exists idx_part_scans_dept       on part_scans (dept);

-- ============================================================
-- ROW LEVEL SECURITY
-- Enable RLS on all tables (configure policies per your auth)
-- ============================================================
alter table messages          enable row level security;
alter table inventory_needs   enable row level security;
alter table damage_reports    enable row level security;
alter table part_scans        enable row level security;

-- Open policies for internal anon use (no login required)
-- All crew use the anon key — no Supabase auth configured.
create policy "anon can read messages"
  on messages for select using (true);

create policy "anon can insert messages"
  on messages for insert with check (true);

create policy "anon can read inventory_needs"
  on inventory_needs for select using (true);

create policy "anon can insert inventory_needs"
  on inventory_needs for insert with check (true);

create policy "anon can update inventory_needs"
  on inventory_needs for update using (true);

create policy "anon can read damage_reports"
  on damage_reports for select using (true);

create policy "anon can insert damage_reports"
  on damage_reports for insert with check (true);

create policy "anon can update damage_reports"
  on damage_reports for update using (true);

create policy "anon can read part_scans"
  on part_scans for select using (true);

create policy "anon can insert part_scans"
  on part_scans for insert with check (true);
