// READ-ONLY verification (Chunk 4): prove the dept-scoped crew search cannot
// surface another department's cabinets. Replicates the EXACT query
// CrewDeptSearch runs (eq tenant, ilike assigned_dept=deptKey, or term match)
// against real Pegasus cabinet_units, for each real dept, and asserts every
// returned row belongs to the scoped dept and that a cabinet living in dept B is
// invisible when scoped to dept A. No writes.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';

// EXACT replica of CrewDeptSearch.run()'s query.
async function scopedSearch(deptKey, term) {
  const t = term.trim().replace(/[,()]/g, ' ').trim();
  return db
    .from('cabinet_units')
    .select('id, job_number, unit_label, cabinet_number, room_number, assigned_dept')
    .eq('tenant_id', TENANT)
    .ilike('assigned_dept', deptKey)
    .or(`unit_label.ilike.%${t}%,cabinet_number.ilike.%${t}%,job_number.ilike.%${t}%`)
    .order('cabinet_number')
    .limit(12);
}

(async () => {
  // What depts actually exist on Pegasus cabinets?
  const { data: allCabs } = await db
    .from('cabinet_units')
    .select('id, assigned_dept, cabinet_number, unit_label, job_number')
    .eq('tenant_id', TENANT)
    .limit(2000);
  const byDept = new Map();
  for (const c of allCabs ?? []) {
    const d = c.assigned_dept ?? '(null)';
    byDept.set(d, (byDept.get(d) ?? 0) + 1);
  }
  console.log(`Pegasus cabinet_units: ${allCabs?.length ?? 0}`);
  console.log('assigned_dept distribution:');
  [...byDept.entries()].forEach(([d, n]) => console.log(`   ${JSON.stringify(d)} ×${n}`));

  const realDepts = [...byDept.keys()].filter((d) => d !== '(null)');
  console.log(`\ndistinct non-null depts: ${realDepts.length} -> ${JSON.stringify(realDepts)}`);

  let pass = true;

  // Test 1: for each real dept, a broad scoped search returns ONLY that dept.
  console.log('\n=== Test 1: every scoped result stays in its dept ===');
  for (const dept of realDepts) {
    const { data } = await scopedSearch(dept.toLowerCase(), 'a'); // 'a' matches most labels/jobs
    const leaked = (data ?? []).filter((r) => (r.assigned_dept ?? '').toLowerCase() !== dept.toLowerCase());
    console.log(`   dept ${JSON.stringify(dept)}: ${data?.length ?? 0} rows, leaked=${leaked.length}`);
    if (leaked.length) { pass = false; leaked.forEach((r) => console.log(`      LEAK: ${JSON.stringify(r.cabinet_number)} is ${JSON.stringify(r.assigned_dept)}`)); }
  }

  // Test 2: take a REAL cabinet's own identifier and confirm it is visible when
  // scoped to ITS dept but invisible when scoped to any OTHER dept — even though
  // the row exists and matches the term. This proves cross-dept isolation with
  // real data regardless of how many depts are populated.
  console.log('\n=== Test 2: a real cabinet is invisible outside its own dept ===');
  const OTHER_DEPTS = ['assembly', 'craftsman', 'finishing', 'qc', 'production'];
  const victim = (allCabs ?? []).find((c) => c.assigned_dept && (c.cabinet_number || c.unit_label));
  if (!victim) {
    console.log('   SKIPPED — no cabinet with an assigned_dept + identifier in Pegasus data.');
  } else {
    const ownDept = victim.assigned_dept.toLowerCase();
    const term = victim.cabinet_number || victim.unit_label;
    // control: visible under its own dept.
    const own = (await scopedSearch(ownDept, term)).data ?? [];
    const seenOwn = own.some((r) => r.id === victim.id);
    console.log(`   victim cabinet ${JSON.stringify(term)} lives in dept ${JSON.stringify(ownDept)}`);
    console.log(`   (control) scoped to own dept ${JSON.stringify(ownDept)}: visible=${seenOwn}`);
    if (!seenOwn) { pass = false; console.log('      UNEXPECTED: not visible even in its own dept'); }
    // isolation: invisible under every other dept.
    for (const other of OTHER_DEPTS) {
      if (other === ownDept) continue;
      const res = (await scopedSearch(other, term)).data ?? [];
      const leaked = res.some((r) => r.id === victim.id);
      console.log(`   scoped to dept ${JSON.stringify(other)}: rows=${res.length}, victim visible=${leaked}`);
      if (leaked) pass = false;
    }
  }

  console.log(`\nRESULT: ${pass ? 'PASS — no cross-dept leakage' : 'FAIL — see leaks above'}`);
  process.exit(pass ? 0 : 1);
})();
