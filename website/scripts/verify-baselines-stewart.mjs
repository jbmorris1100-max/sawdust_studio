// Phase 5 verification: run the REAL committed engine (lib/baselines.ts) against
// the live Stewart tenant's part_dept_events. No reimplementation — we transpile
// the actual source so this exercises exactly what ships. Read-only (no writes).
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

// Transpile the real engine to ESM JS and import it.
const src = readFileSync(new URL('../lib/baselines.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const out = join(tmpdir(), `baselines-engine-${Date.now()}.mjs`);
writeFileSync(out, js);
const { computeBaselines, MIN_SAMPLES } = await import(pathToFileURL(out).href);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Mirror route.ts fetchAllEvents exactly.
const all = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('part_dept_events')
    .select('part_id, cabinet_unit_id, job_number, from_dept, to_dept, worker_name, created_at')
    .eq('tenant_id', TENANT)
    .order('part_id', { ascending: true })
    .order('created_at', { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error('READ ERROR:', error.message); process.exit(1); }
  const rows = data ?? [];
  all.push(...rows);
  if (rows.length < PAGE) break;
}

const r = computeBaselines(all);
console.log('=== Phase 5 engine — REAL run vs Stewart ===');
console.log('tenant_id        :', TENANT);
console.log('MIN_SAMPLES      :', MIN_SAMPLES);
console.log('part_dept_events :', all.length);
console.log('completedStages  :', r.completedStages);
console.log('baselines        :', r.baselines.length, JSON.stringify(r.baselines));
console.log('crewPace         :', r.crewPace.length, JSON.stringify(r.crewPace));
console.log('skippedBaselines :', JSON.stringify(r.skippedBaselines));
console.log('skippedCrew      :', JSON.stringify(r.skippedCrew));
const zero = r.baselines.length === 0 && r.crewPace.length === 0;
console.log(zero ? '\nRESULT: zero baselines/pace — as expected for Stewart.' : '\nRESULT: NON-ZERO — investigate.');
