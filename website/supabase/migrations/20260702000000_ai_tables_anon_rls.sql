-- ── AI tables RLS: open to the anon shop-floor / supervisor client ────────────
-- SECOND FINDING of this bug class after part_dept_events (migration
-- 20260701000000). Same root cause, same reasoning, same fix — mirrored here onto
-- every AI-adjacent table that a browser (anon) client reads or writes.
--
-- ROOT CAUSE (identical to part_dept_events)
--   The supervisor dashboard and the shop floor both run under the anon key with
--   NO Supabase Auth session — auth is a custom PIN / trust-token / WebAuthn HMAC
--   (app/api/supervisor-auth, app/api/crew-auth), so auth.uid() is NULL. The
--   Phase 5/6 tables shipped the strict owner-only policy:
--       tenant_isolation: tenant_id = (SELECT id FROM tenants WHERE owner_user_id = auth.uid())
--   With auth.uid() NULL that subquery is NULL, so the policy matches ZERO rows.
--   Result: the service-role recompute/detect routes WRITE correctly (service role
--   bypasses RLS), but the browser panels that READ/UPDATE these tables get nothing
--   back and every write is silently rejected. This is the same wide-open-vs-owner
--   RLS gap already fixed for part_dept_events, departments, push_subscriptions.
--
-- RLS-STATE AUDIT (all AI-adjacent tables, at time of writing)
--   table                    policy now            browser (anon) consumer                     status
--   ─────────────────────────────────────────────────────────────────────────────────────────────
--   part_dept_events         anon all (FIXED)      JobDrillDown/QcTab/... read; pushPart write  OK (20260701000000)
--   ai_baselines             tenant_isolation      JobDrillDown.tsx:237 READ (Phase 8 drill)    BROKEN (read → 0 rows)
--   ai_crew_pace             tenant_isolation      (no browser reader yet; service-role write)  LATENT (no active consumer)
--   ai_rework_events         tenant_isolation      ReworkPanel.tsx:75 READ, :150/:176 UPDATE    BROKEN (read + confirm/dismiss)
--   ai_rework_suppressions   tenant_isolation      ReworkPanel.tsx:146 INSERT ("don't flag")    BROKEN (write)
--   (ai_learning_log / ai_daily_input / ai_settings already ship FOR ALL using(true) — see
--    supabase/ai_tables.sql — so they are not affected by this gap.)
--   Behavioral proof of the above: scripts/verify-rls-ai-tables.mjs (anon read/insert blocked),
--   and the live probe run during the 2026-07-02 end-to-end chain test (anon ai_baselines=0,
--   service=2; anon ai_crew_pace=0, service=2).
--
-- FIX: mirror part_dept_events — `FOR ALL USING (true) WITH CHECK (true)`, the app's
-- accepted shop-floor anon-key pattern (shift_events, parts, crew_members,
-- push_subscriptions, part_dept_events).
--
-- ⚠️ TRADEOFF — READ THIS BEFORE APPLYING. This is a DELIBERATE reversal of the
-- Phase 5/6 authors' choice. Those migrations chose tenant_isolation ON PURPOSE,
-- noting "per-worker pace is exactly the kind of data that must never leak across
-- shops" (ai_crew_pace) and the cross-tenant bug class (ai_baselines). `using(true)`
-- means ANY holder of the anon key can read/write EVERY tenant's rows in these
-- tables. We accept it because (a) the supervisor client is unavoidably anon, so
-- owner-only simply cannot function, and (b) these tables are DERIVED from
-- part_dept_events / parts / cabinet_units, which already run wide-open under the
-- same anon key — so they expose nothing not already reachable. Proper per-tenant
-- scoping for the anon client (a signed tenant claim in a Supabase JWT) is the real
-- long-term fix and would let all of these revert to tenant_isolation; that is a
-- larger, separate change and is NOT attempted here.
--
-- DROP-then-CREATE keeps this re-runnable on the already-applied tables.

-- ── ai_baselines ──────────────────────────────────────────────────────────────
ALTER TABLE public.ai_baselines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation"           ON public.ai_baselines;
DROP POLICY IF EXISTS "anon can read ai_baselines"   ON public.ai_baselines;
DROP POLICY IF EXISTS "anon can insert ai_baselines" ON public.ai_baselines;
DROP POLICY IF EXISTS "anon can update ai_baselines" ON public.ai_baselines;
DROP POLICY IF EXISTS "anon can delete ai_baselines" ON public.ai_baselines;
DROP POLICY IF EXISTS "anon all ai_baselines"      ON public.ai_baselines;
CREATE POLICY "anon all ai_baselines" ON public.ai_baselines
  FOR ALL USING (true) WITH CHECK (true);

-- ── ai_crew_pace ──────────────────────────────────────────────────────────────
ALTER TABLE public.ai_crew_pace ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation"      ON public.ai_crew_pace;
DROP POLICY IF EXISTS "anon all ai_crew_pace" ON public.ai_crew_pace;
CREATE POLICY "anon all ai_crew_pace" ON public.ai_crew_pace
  FOR ALL USING (true) WITH CHECK (true);

-- ── ai_rework_events ──────────────────────────────────────────────────────────
ALTER TABLE public.ai_rework_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation"         ON public.ai_rework_events;
DROP POLICY IF EXISTS "anon all ai_rework_events" ON public.ai_rework_events;
CREATE POLICY "anon all ai_rework_events" ON public.ai_rework_events
  FOR ALL USING (true) WITH CHECK (true);

-- ── ai_rework_suppressions ────────────────────────────────────────────────────
ALTER TABLE public.ai_rework_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation"               ON public.ai_rework_suppressions;
DROP POLICY IF EXISTS "anon all ai_rework_suppressions" ON public.ai_rework_suppressions;
CREATE POLICY "anon all ai_rework_suppressions" ON public.ai_rework_suppressions
  FOR ALL USING (true) WITH CHECK (true);
