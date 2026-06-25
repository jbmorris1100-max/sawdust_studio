// Read-only: report which of the Phase 2 dimension columns exist on cabinet_units.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const WANT = ['cabinet_name', 'width', 'height', 'depth', 'lr', 'quantity'];

(async () => {
  const present = [];
  const missing = [];
  for (const col of WANT) {
    const { error } = await db.from('cabinet_units').select(col).limit(1);
    if (!error) { present.push(col); continue; }
    missing.push(col);
    console.log(`  ${col}: code=${error.code ?? ''} msg=${JSON.stringify(error.message)}`);
  }
  console.log('present:', present.join(', ') || '(none)');
  console.log('missing:', missing.join(', ') || '(none)');
  console.log(missing.length === 0 ? 'RESULT: ALL APPLIED' : 'RESULT: NOT YET APPLIED');
})();
