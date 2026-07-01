// READ-ONLY verification (Chunk 2): re-extract the real Stewart 'cabinet list.pdf'
// through the LIVE (fixed) extract-cabinet-roster route and print the room values.
// Confirms the CABINET VISION "1Primary Bath Wardrobes" header now extracts as
// "1 Primary Bath Wardrobes". No DB writes.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '';

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

(async () => {
  const { data: row } = await db.from('job_drawings')
    .select('file_name, file_url').eq('tenant_id', TENANT).ilike('file_name', 'cabinet list.pdf').maybeSingle();
  if (!row) { console.error('cabinet list.pdf not found'); process.exit(1); }

  const buf = await (await fetch(row.file_url)).arrayBuffer();
  const text = await fullText(buf);

  // Show the raw header the extractor receives (proves the source has no space).
  const m = text.match(/Room:[^\n]{0,80}/i);
  console.log('RAW PDF header  :', m ? m[0].trim() : '(not found)');
  console.log('BASE            :', BASE, '\n');

  const headers = { 'content-type': 'application/json' };
  // Preview deployments are behind Deployment Protection. A raw node fetch can't
  // carry the bypass cookie across the SSO redirect, so pass the automation
  // bypass secret as a query param (Vercel accepts either) to avoid the redirect.
  let url = `${BASE}/app/api/parse-file`;
  if (BYPASS) {
    headers['x-vercel-protection-bypass'] = BYPASS;
    url += `?x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}&x-vercel-set-bypass-cookie=true`;
  }
  const r = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({ mode: 'extract-cabinet-roster', fileName: row.file_name, docText: text }),
  });
  const { cabinets } = await r.json();
  console.log(`extractor returned ${cabinets?.length ?? 0} cabinet rows\n`);

  const rooms = [...new Set((cabinets ?? []).map((c) => c.room))];
  console.log('DISTINCT room values after fix:');
  rooms.forEach((rm) => console.log('   ', JSON.stringify(rm)));

  console.log('\nfirst 4 rows (id / room / name):');
  for (const c of (cabinets ?? []).slice(0, 4)) {
    console.log('   ', JSON.stringify({ cabinet_id: c.cabinet_id, room: c.room, name: c.name }));
  }

  const anyGlued = rooms.some((rm) => typeof rm === 'string' && /\d[A-Za-z]/.test(rm));
  const fixed = rooms.some((rm) => rm === 'Room 1 Primary Bath Wardrobes');
  console.log(`\nno glued number+name remaining: ${!anyGlued}`);
  console.log(`room now reads "Room 1 Primary Bath Wardrobes": ${fixed}`);
  process.exit(!anyGlued && fixed ? 0 : 1);
})();
