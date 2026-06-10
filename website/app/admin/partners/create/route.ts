import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from '@/lib/adminToken';

// ── Create a partner account ─────────────────────────────────────────────────
// POST { shopName, email, password, trialMonths, discount }
// Creates a Supabase auth user (service role) + a partner tenant row. Admin
// token required.

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const ALLOWED_MONTHS = new Set([3, 6, 9]);
const ALLOWED_DISCOUNTS = new Set([0, 10, 15, 20, 25]);

function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export async function POST(req: Request) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: 'Supabase service role not configured' }, { status: 500 });
  }

  let body: { shopName?: string; email?: string; password?: string; trialMonths?: number; discount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const shopName = String(body.shopName ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const trialMonths = ALLOWED_MONTHS.has(Number(body.trialMonths)) ? Number(body.trialMonths) : 9;
  const discount = ALLOWED_DISCOUNTS.has(Number(body.discount)) ? Number(body.discount) : 25;

  if (!shopName) return NextResponse.json({ ok: false, error: 'Shop name is required' }, { status: 400 });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ ok: false, error: 'A valid email is required' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters' }, { status: 400 });

  // 1. Create the auth user (confirmed so they can log in immediately).
  let ownerUserId: string;
  try {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      return NextResponse.json({ ok: false, error: error?.message ?? 'Could not create auth user' }, { status: 400 });
    }
    ownerUserId = data.user.id;
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Auth user creation failed' }, { status: 500 });
  }

  // 2. Create the partner tenant row.
  const endsAt = addMonths(trialMonths);
  try {
    const { data, error } = await db
      .from('tenants')
      .insert({
        owner_user_id: ownerUserId,
        owner_email: email,
        shop_name: shopName,
        subscription_status: 'active',
        plan: 'operations_monthly',
        is_partner: true,
        partner_discount: discount,
        partner_trial_ends_at: endsAt,
        trial_ends_at: endsAt,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Tenant insert returned no row');
    return NextResponse.json({ ok: true, tenantId: (data as { id: string }).id, email });
  } catch (err) {
    // Roll back the orphaned auth user so a retry with the same email works.
    try { await db.auth.admin.deleteUser(ownerUserId); } catch { /* best-effort */ }
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Tenant creation failed' }, { status: 500 });
  }
}
