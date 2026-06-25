// Read-only Phase 1 test: classify the 17 real Stewart PDFs via the live
// parse-file route. Downloads each PDF, extracts text with pdf.js (node legacy
// build), POSTs mode 'classify-doc', and reports the tag. Writes NOTHING.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const BASE = 'http://localhost:3000';

async function pdfTexts(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false }).promise;
  const pageText = async (p) => {
    const pg = await doc.getPage(p);
    const c = await pg.getTextContent();
    return c.items.map((i) => i.str).join(' ');
  };
  const first = await pageText(1);
  const parts = [first];
  const limit = Math.min(doc.numPages, 20);
  for (let p = 2; p <= limit; p++) { try { parts.push(await pageText(p)); } catch {} }
  return { firstPageText: first, fullText: parts.join('\n'), pageCount: doc.numPages };
}

(async () => {
  const { data, error } = await db.from('job_drawings')
    .select('id, file_name, file_url').eq('tenant_id', TENANT).order('created_at');
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Classifying ${data.length} files…\n`);
  const results = [];
  for (const row of data) {
    let tag = '?', reason = '', textLen = 0;
    try {
      const resp = await fetch(row.file_url);
      const buf = await resp.arrayBuffer();
      const { firstPageText, pageCount } = await pdfTexts(buf);
      textLen = firstPageText.length;
      const r = await fetch(`${BASE}/app/api/parse-file`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'classify-doc', fileName: row.file_name, firstPageText, pageCount }),
      });
      const j = await r.json();
      tag = j.doc_type ?? `HTTP${r.status}`;
      reason = j.reason ?? '';
    } catch (e) { tag = 'ERROR'; reason = e.message; }
    results.push({ file: row.file_name, tag, reason, textLen });
    console.log(`${String(tag).padEnd(20)} | ${row.file_name.padEnd(42)} | txt=${textLen} | ${reason}`);
  }
  console.log('\n--- summary by tag ---');
  const by = {};
  for (const r of results) (by[r.tag] ??= []).push(r.file);
  for (const [t, fs] of Object.entries(by)) console.log(`${t}: ${fs.length}`);
})();
