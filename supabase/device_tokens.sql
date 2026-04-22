-- ============================================================
-- device_tokens — stores Expo push tokens per crew member
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

create table if not exists device_tokens (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  dept       text        not null,
  token      text        not null,
  created_at timestamptz not null default now(),
  -- one row per physical token; updating name/dept on re-register
  constraint device_tokens_token_key unique (token)
);

create index if not exists idx_device_tokens_name on device_tokens (name);

alter table device_tokens enable row level security;

create policy "anon can insert device_tokens"
  on device_tokens for insert with check (true);

create policy "anon can upsert device_tokens"
  on device_tokens for update using (true);

create policy "anon can read device_tokens"
  on device_tokens for select using (true);
