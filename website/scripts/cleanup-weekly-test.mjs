// Cleanup for tests/weekly-summary.spec.ts seeded rows. Scoped NARROWLY to the
// E2E job numbers on the test tenant. DRY by default (counts only); --apply deletes.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const T = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const targets = [
  {
    label: "cabinet_units  (job_number in E2E-WK-A / E2E-WK-B)",
    count: () => db.from('cabinet_units').select('id', { count: 'exact', head: true }).eq('tenant_id', T).in('job_number', ['E2E-WK-A', 'E2E-WK-B']),
    del:   () => db.from('cabinet_units').delete().eq('tenant_id', T).in('job_number', ['E2E-WK-A', 'E2E-WK-B']),
  },
  {
    label: "time_clock  (worker_name='E2E WK', job_number in E2E-WK-A / E2E-WK-B)",
    count: () => db.from('time_clock').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('worker_name', 'E2E WK').in('job_number', ['E2E-WK-A', 'E2E-WK-B']),
    del:   () => db.from('time_clock').delete().eq('tenant_id', T).eq('worker_name', 'E2E WK').in('job_number', ['E2E-WK-A', 'E2E-WK-B']),
  },
];

console.log(`tenant ${T} — ${APPLY ? 'APPLY (deleting)' : 'DRY RUN (counts only; pass --apply to delete)'}`);
for (const t of targets) {
  const { count } = await t.count();
  if (APPLY) {
    const { error } = await t.del();
    console.log(`  ${error ? 'ERROR ' + error.message : 'deleted'} ${count ?? 0}  ${t.label}`);
  } else {
    console.log(`  would delete ${count ?? 0}  ${t.label}`);
  }
}
