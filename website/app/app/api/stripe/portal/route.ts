import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';

// ── Stripe Billing Portal session creator ───────────────────────────────────
// POST { tenant_id }. Auth via Supabase access token (Bearer). Opens the hosted
// customer portal where the tenant owner can update card, view invoices, or
// cancel. Returns { url }.

const RETURN_URL = 'https://inlineiq.app/app/supervisor';

function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const db = serviceDb();
    if (!db) {
      return NextResponse.json({ error: 'Supabase service role not configured' }, { status: 500 });
    }

    const auth = req.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: { tenant_id?: string };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { tenant_id } = payload;
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });
    }

    const { data: tenantData, error: tErr } = await db
      .from('tenants')
      .select('id, owner_user_id, stripe_customer_id')
      .eq('id', tenant_id)
      .single();
    const tenant = tenantData as {
      id: string; owner_user_id: string | null; stripe_customer_id: string | null;
    } | null;
    if (tErr || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    if (tenant.owner_user_id !== userData.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!tenant.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing account yet — start a subscription first' }, { status: 400 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: RETURN_URL,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error('Stripe portal error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Portal failed' },
      { status: 500 },
    );
  }
}
