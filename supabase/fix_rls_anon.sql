-- ============================================================
-- Fix RLS: allow anon role (no auth required)
-- Internal shop floor app — crew uses anon key only.
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Drop all existing policies
drop policy if exists "authenticated users can read messages"          on messages;
drop policy if exists "authenticated users can insert messages"        on messages;

drop policy if exists "authenticated users can read inventory_needs"   on inventory_needs;
drop policy if exists "authenticated users can insert inventory_needs" on inventory_needs;
drop policy if exists "authenticated users can update inventory_needs" on inventory_needs;

drop policy if exists "authenticated users can read damage_reports"    on damage_reports;
drop policy if exists "authenticated users can insert damage_reports"  on damage_reports;
drop policy if exists "authenticated users can update damage_reports"  on damage_reports;

drop policy if exists "authenticated users can read part_scans"        on part_scans;
drop policy if exists "authenticated users can insert part_scans"      on part_scans;

-- ── messages ─────────────────────────────────────────────────
create policy "anon can read messages"
  on messages for select using (true);

create policy "anon can insert messages"
  on messages for insert with check (true);

-- ── inventory_needs ───────────────────────────────────────────
create policy "anon can read inventory_needs"
  on inventory_needs for select using (true);

create policy "anon can insert inventory_needs"
  on inventory_needs for insert with check (true);

create policy "anon can update inventory_needs"
  on inventory_needs for update using (true);

-- ── damage_reports ────────────────────────────────────────────
create policy "anon can read damage_reports"
  on damage_reports for select using (true);

create policy "anon can insert damage_reports"
  on damage_reports for insert with check (true);

create policy "anon can update damage_reports"
  on damage_reports for update using (true);

-- ── part_scans ────────────────────────────────────────────────
create policy "anon can read part_scans"
  on part_scans for select using (true);

create policy "anon can insert part_scans"
  on part_scans for insert with check (true);
