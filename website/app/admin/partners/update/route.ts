import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from '@/lib/adminToken';

// ── Update a partner tenant ──────────────────────────────────────────────────
// PATCH { tenantId, partner_trial_ends_at?, partner_discount?, is_partner? }
// Extend trial, change discount, or revoke. Revoking (is_partner=false) drops
// the tenant back to the standard trial flow (subscription_status='trial').
// Admin token required.

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const ALLOWED_DISCOUNTS = new Set([0, 10, 15, 20, 25]);

export async function PATCH(req: Request) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: 'Supabase service role not configured' }, { status: 500 });
  }

  let body: { tenantId?: string; partner_trial_ends_at?: string | null; partner_discount?: number; is_partner?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = String(body.tenantId ?? '');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'tenantId required' }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (body.partner_trial_ends_at !== undefined) {
    if (body.partner_trial_ends_at === null) {
      patch.partner_trial_ends_at = null;
    } else {
      const d = new Date(body.partner_trial_ends_at);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 });
      patch.partner_trial_ends_at = d.toISOString();
    }
  }

  if (body.partner_discount !== undefined) {
    const disc = Number(body.partner_discount);
    if (!ALLOWED_DISCOUNTS.has(disc)) return NextResponse.json({ ok: false, error: 'Invalid discount' }, { status: 400 });
    patch.partner_discount = disc;
  }

  if (body.is_partner !== undefined) {
    patch.is_partner = !!body.is_partner;
    // Revoke → return them to the standard trial flow from this point.
    if (body.is_partner === false) patch.subscription_status = 'trial';
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 });
  }

  try {
    const { error } = await db.from('tenants').update(patch).eq('id', tenantId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
  }
}
