// Cleanup for tests/ai-drilldown.spec.ts seeded rows. Scoped NARROWLY to the
// synthetic markers on the test tenant. DRY by default (counts only); --apply
// deletes. Also resets the test tenant's ai_mode back to 'learn' (the default),
// since the spec toggles it to 'assist' to exercise auto-drill.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const T = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const JOB = 'E2E-DRILL-1';
const BASELINE_MARKER = 'E2E-DRILL'; // ai_baselines.job_type marker (real rows use NULL)
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Delete children before parents (no reliance on cascade).
const targets = [
  {
    label: "part_dept_events  (job_number = E2E-DRILL-1)",
    count: () => db.from('part_dept_events').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('job_number', JOB),
    del:   () => db.from('part_dept_events').delete().eq('tenant_id', T).eq('job_number', JOB),
  },
  {
    label: "parts  (job_number = E2E-DRILL-1)",
    count: () => db.from('parts').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('job_number', JOB),
    del:   () => db.from('parts').delete().eq('tenant_id', T).eq('job_number', JOB),
  },
  {
    label: "cabinet_units  (job_number = E2E-DRILL-1)",
    count: () => db.from('cabinet_units').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('job_number', JOB),
    del:   () => db.from('cabinet_units').delete().eq('tenant_id', T).eq('job_number', JOB),
  },
  {
    label: "ai_baselines  (job_type = E2E-DRILL marker)",
    count: () => db.from('ai_baselines').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('job_type', BASELINE_MARKER),
    del:   () => db.from('ai_baselines').delete().eq('tenant_id', T).eq('job_type', BASELINE_MARKER),
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

// ai_mode is a setting, not a seeded row — restore it to the 'learn' default.
if (APPLY) {
  const { error } = await db.from('tenants').update({ ai_mode: 'learn' }).eq('id', T);
  console.log(`  ${error ? 'ERROR ' + error.message : "reset ai_mode -> 'learn' (default)"}`);
} else {
  const { data } = await db.from('tenants').select('ai_mode').eq('id', T).maybeSingle();
  console.log(`  would reset ai_mode (currently '${data?.ai_mode ?? '?'}') -> 'learn'`);
}
