// Cleanup for tests/rework.spec.ts seeded/test rows. Scoped NARROWLY to E2E
// markers on the test tenant only. Pass --apply to delete; default is DRY (counts
// only) so the exact scope can be reviewed before anything is removed.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const T = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f'; // test tenant ONLY
const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Resolve the throwaway parts first (E2E Rework Alpha/Beta <run>) so we can scope
// ai_rework_events by their part_id.
const { data: parts } = await db.from('parts').select('id').eq('tenant_id', T).like('part_name', 'E2E Rework %');
const partIds = (parts ?? []).map((p) => p.id);

// Each entry: a human-readable description + a count query + the delete.
const targets = [
  {
    label: "ai_rework_events  (part_id in E2E parts)",
    count: () => db.from('ai_rework_events').select('id', { count: 'exact', head: true }).eq('tenant_id', T).in('part_id', partIds.length ? partIds : ['00000000-0000-0000-0000-000000000000']),
    del:   () => db.from('ai_rework_events').delete().eq('tenant_id', T).in('part_id', partIds.length ? partIds : ['00000000-0000-0000-0000-000000000000']),
  },
  {
    label: "ai_rework_suppressions  (part_name_pattern like 'rework alpha %' / 'rework beta %')",
    count: () => db.from('ai_rework_suppressions').select('id', { count: 'exact', head: true }).eq('tenant_id', T).or('part_name_pattern.like.rework alpha %,part_name_pattern.like.rework beta %'),
    del:   () => db.from('ai_rework_suppressions').delete().eq('tenant_id', T).or('part_name_pattern.like.rework alpha %,part_name_pattern.like.rework beta %'),
  },
  {
    label: "damage_reports  (logged_by_role=supervisor AND part_name like 'E2E Rework %')",
    count: () => db.from('damage_reports').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('logged_by_role', 'supervisor').like('part_name', 'E2E Rework %'),
    del:   () => db.from('damage_reports').delete().eq('tenant_id', T).eq('logged_by_role', 'supervisor').like('part_name', 'E2E Rework %'),
  },
  {
    label: "part_dept_events  (worker_name = 'E2E')",
    count: () => db.from('part_dept_events').select('id', { count: 'exact', head: true }).eq('tenant_id', T).eq('worker_name', 'E2E'),
    del:   () => db.from('part_dept_events').delete().eq('tenant_id', T).eq('worker_name', 'E2E'),
  },
  {
    label: "parts  (part_name like 'E2E Rework %')",
    count: () => db.from('parts').select('id', { count: 'exact', head: true }).eq('tenant_id', T).like('part_name', 'E2E Rework %'),
    del:   () => db.from('parts').delete().eq('tenant_id', T).like('part_name', 'E2E Rework %'),
  },
];

console.log(`tenant ${T} — ${APPLY ? 'APPLY (deleting)' : 'DRY RUN (counts only; pass --apply to delete)'}`);
console.log(`E2E parts found: ${partIds.length}`);
for (const t of targets) {
  const { count } = await t.count();
  if (APPLY) {
    const { error } = await t.del();
    console.log(`  ${error ? 'ERROR ' + error.message : 'deleted'} ${count ?? 0}  ${t.label}`);
  } else {
    console.log(`  would delete ${count ?? 0}  ${t.label}`);
  }
}
