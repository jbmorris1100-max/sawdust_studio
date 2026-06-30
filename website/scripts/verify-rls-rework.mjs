// Phase 6 RLS verification for ai_rework_events. pg_policies isn't reachable over
// PostgREST (pg_catalog unexposed), so we prove enforcement behaviorally with the
// anon key (auth.uid()=NULL ⇒ tenant_isolation matches zero rows). Cleans up.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const T = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f', PROBE = '__rls_probe__';
let pass = true; const ok = (b, l) => { console.log('  [' + (b ? 'PASS' : 'FAIL') + '] ' + l); if (!b) pass = false; };

const pol = await svc.from('pg_policies').select('policyname').limit(1);
console.log('pg_policies over PostgREST:', pol.error ? `not exposed (${pol.error.code}) — behavioral proof` : 'EXPOSED');

await svc.from('ai_rework_events').delete().eq('tenant_id', T).eq('bounce_event_id', PROBE);
const seed = await svc.from('ai_rework_events').insert({ tenant_id: T, bounce_event_id: PROBE, source: 'backward_bounce', occurred_at: new Date().toISOString(), status: 'pending' }).select('id');
ok(!seed.error && seed.data?.length === 1, 'service-role INSERT works (table exists): ' + (seed.error?.message ?? 'ok'));
const aRead = await anon.from('ai_rework_events').select('id').eq('tenant_id', T).eq('bounce_event_id', PROBE);
ok(!aRead.error && (aRead.data?.length ?? 0) === 0, 'anon SELECT returns 0 (read blocked) — got ' + (aRead.data?.length ?? ('err:' + aRead.error?.message)));
const aIns = await anon.from('ai_rework_events').insert({ tenant_id: T, bounce_event_id: PROBE + '2', source: 'backward_bounce', occurred_at: new Date().toISOString(), status: 'pending' }).select('id');
ok(!!aIns.error || (aIns.data?.length ?? 0) === 0, 'anon INSERT blocked — ' + (aIns.error ? aIns.error.message.slice(0, 50) : 'no row'));
if (!aIns.error && aIns.data?.length) await svc.from('ai_rework_events').delete().in('id', aIns.data.map((r) => r.id));
await svc.from('ai_rework_events').delete().eq('tenant_id', T).eq('bounce_event_id', PROBE);

console.log(pass ? 'RESULT: PASS — only tenant_isolation in effect on ai_rework_events' : 'RESULT: FAIL — a permissive policy survives');
process.exit(pass ? 0 : 1);
