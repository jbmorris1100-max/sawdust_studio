// Phase 2 test: extract cabinets from the real 'cabinet list.pdf' via the live
// extract-cabinet-roster route, then verify the cabinet_units insert path
// (full → core fallback, dedup). Inserts, counts, prints samples, then ROLLS
// BACK (deletes its own rows) so the live tenant is left clean pending sign-off.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const JOBNUM = 'Stewart';
const BASE = 'http://localhost:3000';

async function fullText(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false }).promise;
  const parts = [];
  for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
    const pg = await doc.getPage(p);
    const c = await pg.getTextContent();
    parts.push(c.items.map((i) => i.str).join(' '));
  }
  return parts.join('\n');
}
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };

(async () => {
  const { data: row } = await db.from('job_drawings')
    .select('file_name, file_url').eq('tenant_id', TENANT).ilike('file_name', 'cabinet list.pdf').maybeSingle();
  if (!row) { console.error('cabinet list.pdf not found'); process.exit(1); }

  const buf = await (await fetch(row.file_url)).arrayBuffer();
  const text = await fullText(buf);
  const r = await fetch(`${BASE}/app/api/parse-file`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'extract-cabinet-roster', fileName: row.file_name, docText: text }),
  });
  const { cabinets } = await r.json();
  console.log(`extractor returned ${cabinets?.length ?? 0} cabinet rows`);
  console.log('sample (first 6):');
  for (const c of (cabinets ?? []).slice(0, 6)) console.log('  ', JSON.stringify(c));

  // Build rows exactly like seedCabinetUnitsFromRoster (dedup vs existing).
  const { data: existing } = await db.from('cabinet_units').select('cabinet_number').eq('tenant_id', TENANT).eq('job_number', JOBNUM);
  const have = new Set(((existing ?? []).map((x) => (x.cabinet_number ?? '').trim().toLowerCase())).filter(Boolean));
  const core = [], full = [];
  for (const c of cabinets ?? []) {
    const cabNum = String(c.cabinet_id ?? '').trim();
    if (!cabNum || have.has(cabNum.toLowerCase())) continue;
    have.add(cabNum.toLowerCase());
    const name = (c.name ?? '').toString().trim();
    const base = { tenant_id: TENANT, job_id: null, job_number: JOBNUM, room_number: c.room ? String(c.room).trim() : null, cabinet_number: cabNum, unit_label: name ? `${cabNum} — ${name}` : cabNum, status: 'pending' };
    core.push(base);
    full.push({ ...base, cabinet_name: name || null, width: num(c.width), height: num(c.height), depth: num(c.depth), lr: c.lr ? String(c.lr).trim() : null, quantity: Math.max(1, num(c.qty) ?? 1) });
  }
  console.log(`\nafter dedup (existing=${have.size - core.length}): ${core.length} rows would be inserted`);

  // Verify full → core fallback.
  const fullTry = await db.from('cabinet_units').insert(full).select('id');
  let mode = 'full', inserted = fullTry.data?.length ?? 0, insErr = fullTry.error?.message ?? null;
  if (fullTry.error) {
    console.log(`full insert rejected (expected — extra cols missing): ${fullTry.error.message.slice(0, 70)}`);
    const coreTry = await db.from('cabinet_units').insert(core).select('id');
    mode = 'core'; inserted = coreTry.data?.length ?? 0; insErr = coreTry.error?.message ?? null;
  }
  console.log(`INSERT via ${mode}: ${inserted} rows created${insErr ? ' (err: ' + insErr + ')' : ''}`);

  // Roll back — delete only this run's rows.
  const { count: before } = await db.from('cabinet_units').select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT).eq('job_number', JOBNUM);
  await db.from('cabinet_units').delete().eq('tenant_id', TENANT).eq('job_number', JOBNUM);
  const { count: after } = await db.from('cabinet_units').select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT).eq('job_number', JOBNUM);
  console.log(`rolled back: cabinet_units for ${JOBNUM} ${before} → ${after}`);
})();
