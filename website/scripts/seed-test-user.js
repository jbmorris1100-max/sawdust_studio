#!/usr/bin/env node
/**
 * Seed script — creates the default test account and a matching tenant row.
 *
 * Prerequisites:
 *   1. Add SUPABASE_SERVICE_ROLE_KEY to website/.env.local
 *      (Supabase dashboard → Project Settings → API → service_role secret)
 *   2. Run the SQL migration:  supabase/tenants_and_subscriptions.sql
 *   3. In Supabase dashboard → Authentication → Settings
 *      set "Enable email confirmations" = OFF for local dev
 *
 * Run:
 *   cd website && npm run seed
 *
 * Test credentials created:
 *   Email:    user@inlineiq.app
 *   Password: 1
 */

const path = require('path');
const fs   = require('fs');

// Load website/.env.local without requiring dotenv
function loadEnv(filePath) {
  try {
    fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .forEach((line) => {
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      });
  } catch { /* file may not exist */ }
}

loadEnv(path.join(__dirname, '..', '.env.local'));

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('✗  Missing NEXT_PUBLIC_SUPABASE_URL in website/.env.local');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error('✗  Missing SUPABASE_SERVICE_ROLE_KEY in website/.env.local');
  console.error('   Get it from: Supabase dashboard → Project Settings → API → service_role');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_EMAIL    = 'user@inlineiq.app';
const TEST_PASSWORD = '1';
const SHOP_NAME     = 'InlineIQ Demo Shop';

async function seed() {
  console.log('Seeding test account…\n');

  // ── 1. Create / ensure auth user ────────────────────────────
  let userId;

  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email:          TEST_EMAIL,
      password:       TEST_PASSWORD,
      email_confirm:  true,
    });

  if (createErr) {
    if (createErr.message.toLowerCase().includes('already registered') ||
        createErr.message.toLowerCase().includes('already been registered')) {
      // User exists — look them up
      const { data: users, error: listErr } =
        await supabase.auth.admin.listUsers();
      if (listErr) throw listErr;
      const existing = users.users.find((u) => u.email === TEST_EMAIL);
      if (!existing) throw new Error('User exists but could not be found in listUsers()');
      userId = existing.id;
      console.log(`  • Auth user already exists  (id: ${userId})`);
    } else {
      throw createErr;
    }
  } else {
    userId = created.user.id;
    console.log(`  ✓ Auth user created         (id: ${userId})`);
  }

  // ── 2. Update password (idempotent) ─────────────────────────
  await supabase.auth.admin.updateUserById(userId, { password: TEST_PASSWORD });

  // ── 3. Upsert tenant row ─────────────────────────────────────
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error: tenantErr } = await supabase
    .from('tenants')
    .upsert(
      {
        company_name:        SHOP_NAME,
        owner_email:         TEST_EMAIL,
        owner_user_id:       userId,
        subscription_status: 'trial',
        trial_ends_at:       trialEndsAt,
      },
      { onConflict: 'owner_email' }
    );

  if (tenantErr) {
    // Might fail if table doesn't exist yet
    if (tenantErr.message.includes('relation') && tenantErr.message.includes('does not exist')) {
      console.error('\n✗  The tenants table does not exist.');
      console.error('   Run this SQL first:  supabase/tenants_and_subscriptions.sql\n');
      process.exit(1);
    }
    throw tenantErr;
  }

  console.log(`  ✓ Tenant row upserted       (trial ends: ${trialEndsAt.slice(0, 10)})`);

  console.log('\n────────────────────────────────────────');
  console.log('  Test credentials');
  console.log('  Email:    user@inlineiq.app');
  console.log('  Password: 1');
  console.log('────────────────────────────────────────\n');
}

seed().catch((err) => {
  console.error('\n✗  Seed failed:', err.message ?? err);
  process.exit(1);
});
