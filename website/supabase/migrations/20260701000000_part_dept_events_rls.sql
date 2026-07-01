-- ── part_dept_events RLS: open to the anon shop-floor client ──────────────────
-- ROOT CAUSE THIS FIXES: part_dept_events shipped with the strict owner-only
-- policy (tenant_id = tenants.owner_user_id = auth.uid()). But the shop floor
-- runs under the anon key with NO Supabase Auth session — crew authenticate via
-- a custom PIN/WebAuthn HMAC token (app/api/crew-auth), so auth.uid() is null.
-- Result: every pushPart() insert into part_dept_events was silently rejected by
-- RLS (the error was swallowed by the best-effort .catch), AND the supervisor
-- drill-downs that READ this table (JobDrillDown, QcTab, AssemblyTab,
-- QcInspectorView) got zero rows back. The table had 0 rows despite the code
-- being correct. See partActions.ts pushPart() step 2.
--
-- FIX: mirror the sibling log table written in the very same function —
-- shift_events uses `FOR ALL USING (true) WITH CHECK (true)` (shift_tracking.sql),
-- as do parts_log / crew_members / push_subscriptions. This is the app's accepted
-- shop-floor anon-key pattern (banked as a known tradeoff, not fixed per-table).
--
-- DROP-then-CREATE keeps this re-runnable on the already-applied table.
ALTER TABLE public.part_dept_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON public.part_dept_events;
DROP POLICY IF EXISTS "anon all part_dept_events" ON public.part_dept_events;
CREATE POLICY "anon all part_dept_events" ON public.part_dept_events
  FOR ALL USING (true) WITH CHECK (true);
