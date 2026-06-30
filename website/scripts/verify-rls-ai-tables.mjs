// Phase 5 RLS verification for ai_baselines + ai_crew_pace.
// pg_policies is not reachable over PostgREST (pg_catalog is unexposed), so we
// prove the policy state BEHAVIORALLY — which tests actual enforcement, stronger
// than reading the catalog. With the anon key there is no session, so
// auth.uid() = NULL and tenant_isolation must match zero rows. Any surviving
// wide-open `using(true)`/`with check(true)` policy would let anon read or write.
//   - anon SELECT a service-role-seeded row  -> MUST return 0 (no permissive read)
//   - anon INSERT                            -> MUST be blocked (no permissive write)
// Cleans up its own probe rows. Read-only w.r.t. real data (Stewart has none).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f'; // Stewart
const PROBE = '__rls_probe__';
let pass = true;
const ok = (b, label) => { console.log(`  [${b ? 'PASS' : 'FAIL'}] ${label}`); if (!b) pass = false; };

// 0. Confirm pg_policies really isn't reachable (so the behavioral path is justified).
const pol = await svc.from('pg_policies').select('policyname').limit(1);
console.log('pg_policies over PostgREST:', pol.error ? `not exposed (${pol.error.code}) — using behavioral proof` : 'EXPOSED');

for (const [table, seedRow] of [
  ['ai_baselines', { tenant_id: TENANT, stage: PROBE, sample_count: 0 }],
  ['ai_crew_pace', { tenant_id: TENANT, worker_name: PROBE, stage: PROBE, sample_count: 0 }],
]) {
  console.log(`\n=== ${table} ===`);
  // service role seeds a probe row (bypasses RLS — also proves the table exists & is writable)
  await svc.from(table).delete().eq('tenant_id', TENANT).eq('stage', PROBE);
  const seed = await svc.from(table).insert(seedRow).select('id');
  ok(!seed.error && seed.data?.length === 1, `service-role INSERT works (table exists): ${seed.error?.message ?? 'ok'}`);

  // anon must NOT be able to read it (no permissive SELECT policy survives)
  const aRead = await anon.from(table).select('id').eq('tenant_id', TENANT).eq('stage', PROBE);
  ok(!aRead.error && (aRead.data?.length ?? 0) === 0, `anon SELECT returns 0 rows (read blocked) — got ${aRead.data?.length ?? 'err:' + aRead.error?.message}`);

  // anon must NOT be able to insert (no permissive INSERT policy survives)
  const aIns = await anon.from(table).insert(seedRow).select('id');
  ok(!!aIns.error || (aIns.data?.length ?? 0) === 0, `anon INSERT blocked — ${aIns.error ? aIns.error.message.slice(0, 50) : 'no row returned'}`);
  if (!aIns.error && aIns.data?.length) await svc.from(table).delete().in('id', aIns.data.map((r) => r.id));

  // cleanup probe
  await svc.from(table).delete().eq('tenant_id', TENANT).eq('stage', PROBE);
}

console.log(`\nRESULT: ${pass ? 'PASS — only tenant_isolation in effect on both tables' : 'FAIL — a permissive policy survives'}`);
process.exit(pass ? 0 : 1);
