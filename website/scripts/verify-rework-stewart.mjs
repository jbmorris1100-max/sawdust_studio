// Phase 6 verification: run the REAL committed detector (lib/rework.ts) against the
// live Stewart tenant. Transpiles the actual source (no reimplementation). Read-only.
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const ts = require('typescript');

const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f'; // Stewart
const PAGE = 1000;

const tx = (s) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
// Transpile the dependency (partNamePattern) too, and point rework's import at it.
const pnp = join(tmpdir(), `pnp-${Date.now()}.mjs`);
writeFileSync(pnp, tx(readFileSync(new URL('../lib/partNamePattern.ts', import.meta.url), 'utf8')));
const reworkSrc = readFileSync(new URL('../lib/rework.ts', import.meta.url), 'utf8');
const js = tx(reworkSrc).replace(/from ['"]\.\/partNamePattern['"]/, `from ${JSON.stringify(pathToFileURL(pnp).href)}`);
const out = join(tmpdir(), `rework-engine-${Date.now()}.mjs`);
writeFileSync(out, js);
const { computeRework, confirmedCount } = await import(pathToFileURL(out).href);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function pageAll(table, sel) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(sel).eq('tenant_id', TENANT).order('created_at', { ascending: true }).range(from, from + PAGE - 1);
    if (error) { console.error(`${table} read error:`, error.message); process.exit(1); }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

const { data: depts } = await db.from('departments').select('name, sort_order').eq('tenant_id', TENANT);
const deptOrder = {};
for (const d of depts ?? []) if (d.name) deptOrder[d.name.trim().toLowerCase()] = d.sort_order;

const events = await pageAll('part_dept_events', 'part_id, cabinet_unit_id, job_number, from_dept, to_dept, worker_name, created_at');
const damage = await pageAll('damage_reports', 'id, part_name, job_id, dept, report_type, created_at');

// part names + suppressions (same inputs the route feeds the engine).
const partNames = {};
{
  const { data } = await db.from('parts').select('id, part_name').eq('tenant_id', TENANT);
  for (const r of data ?? []) partNames[r.id] = r.part_name;
}
const suppressions = new Set();
{
  const { data } = await db.from('ai_rework_suppressions').select('from_dept, to_dept, part_name_pattern').eq('tenant_id', TENANT);
  for (const s of data ?? []) suppressions.add(`${s.from_dept.trim().toLowerCase()}|${s.to_dept.trim().toLowerCase()}|${s.part_name_pattern}`);
}

const r = computeRework(events, damage, deptOrder, { partNames, suppressions });
console.log('=== Phase 6 detector — REAL run vs Stewart ===');
console.log('tenant_id          :', TENANT);
console.log('departments        :', Object.keys(deptOrder).length, JSON.stringify(deptOrder));
console.log('part_dept_events   :', events.length);
console.log('damage_reports     :', damage.length);
console.log('qc_fail rows       :', r.qcFail, '(auto-confirmed)');
console.log('damage rows        :', r.damage, '(auto-confirmed)');
console.log('backward_bounce    :', r.backwardBounce, '(pending — not counted)');
console.log('suppressedByRule   :', r.suppressedByRule, '(marked normal — not flagged)');
console.log('bounce events (UI) :', r.bounceEvents);
console.log('skippedUnknownDept :', r.skippedUnknownDept);
console.log('confirmedCount     :', confirmedCount(r.rework), '(the rework metric)');
const zero = r.rework.length === 0;
console.log(zero ? '\nRESULT: zero rework events — as expected for Stewart (0 part_dept_events, 0 damage).' : '\nRESULT: NON-ZERO — inspect above.');
