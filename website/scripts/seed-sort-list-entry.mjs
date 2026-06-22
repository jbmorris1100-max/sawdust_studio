#!/usr/bin/env node
/**
 * Seed ONE Sort List test entry for the E2E supervisor test.
 *
 * Creates, on the TEST tenant only:
 *   • a cabinet_unit with a unique, recognizable unit_label
 *   • one part under that unit (so the Assign flow has something to move)
 *   • a sort_list queue row pointing at the unit
 *
 * It prints the values the Playwright spec needs (TEST_CABINET_UNIT_ID,
 * TEST_UNIT_LABEL). Re-run any time you need a fresh entry — each run makes a
 * new unit, so it never collides with a previous one.
 *
 * Usage:
 *   cd website && node scripts/seed-sort-list-entry.mjs
 *   cd website && node scripts/seed-sort-list-entry.mjs --clean   # remove all E2E units
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

// Hard-coded TEST tenant — this script must never touch a real customer tenant.
const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const LABEL_PREFIX = 'E2E-SORT-TEST';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in website/.env.local');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function clean() {
  // Find every E2E test unit, then delete its sort_list rows, parts, and the unit.
  const { data: units } = await sb
    .from('cabinet_units')
    .select('id')
    .eq('tenant_id', TEST_TENANT)
    .like('unit_label', `${LABEL_PREFIX}%`);
  const ids = (units ?? []).map((u) => u.id);
  if (ids.length === 0) { console.log('Nothing to clean.'); return; }
  await sb.from('sort_list').delete().eq('tenant_id', TEST_TENANT).in('cabinet_unit_id', ids);
  await sb.from('parts').delete().eq('tenant_id', TEST_TENANT).in('cabinet_unit_id', ids);
  await sb.from('cabinet_units').delete().eq('tenant_id', TEST_TENANT).in('id', ids);
  console.log(`Cleaned ${ids.length} E2E test unit(s).`);
}

async function seed() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unitLabel = `${LABEL_PREFIX} ${stamp}`;
  const jobNumber = 'E2E-JOB';

  // 1. cabinet_unit — assigned_dept left null so it mirrors a real unsorted unit.
  const { data: unit, error: uErr } = await sb
    .from('cabinet_units')
    .insert({
      tenant_id: TEST_TENANT,
      unit_label: unitLabel,
      cabinet_number: 'E2E-1',
      room_number: 'E2E',
      job_number: jobNumber,
      assigned_dept: null,
    })
    .select('id')
    .single();
  if (uErr) throw uErr;

  // 2. one part under it
  const { error: pErr } = await sb.from('parts').insert({
    tenant_id: TEST_TENANT,
    cabinet_unit_id: unit.id,
    job_number: jobNumber,
    part_name: 'E2E Test Side',
    material: '3/4 Ply',
    quantity: 1,
  });
  if (pErr) throw pErr;

  // 3. the sort_list queue row
  const { error: sErr } = await sb.from('sort_list').insert({
    tenant_id: TEST_TENANT,
    cabinet_unit_id: unit.id,
    job_number: jobNumber,
  });
  if (sErr) throw sErr;

  console.log('\n✓ Seeded Sort List test entry on the TEST tenant (Pegasus).\n');
  console.log('  Set these for the Playwright run:');
  console.log(`  export TEST_CABINET_UNIT_ID='${unit.id}'`);
  console.log(`  export TEST_UNIT_LABEL='${unitLabel}'\n`);
}

const run = process.argv.includes('--clean') ? clean : seed;
run().catch((err) => { console.error('✗ Failed:', err.message ?? err); process.exit(1); });
