import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from '@/lib/adminToken';

// ── List partner tenants ─────────────────────────────────────────────────────
// GET → all tenants where is_partner = true, newest first. Admin token required.

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: 'Supabase service role not configured' }, { status: 500 });
  }

  try {
    const { data, error } = await db
      .from('tenants')
      .select('id, shop_name, owner_email, plan, subscription_status, is_partner, partner_discount, partner_trial_ends_at, trial_ends_at, created_at')
      .eq('is_partner', true)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return NextResponse.json({ ok: true, partners: data ?? [] });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load partners' }, { status: 500 });
  }
}
