-- ============================================================
-- SOP Views — tracks which crew members have read each SOP
-- Run AFTER sops.sql
-- ============================================================

create table if not exists sop_views (
  id           uuid        primary key default gen_random_uuid(),
  sop_id       uuid        not null references sops(id) on delete cascade,
  viewer_name  text        not null,
  viewer_dept  text        not null,
  viewed_at    timestamptz not null default now()
);

create index if not exists idx_sop_views_sop_id    on sop_views (sop_id);
create index if not exists idx_sop_views_viewed_at on sop_views (viewed_at desc);

alter table sop_views enable row level security;

create policy "anon can read sop_views"
  on sop_views for select using (true);

create policy "anon can insert sop_views"
  on sop_views for insert with check (true);
