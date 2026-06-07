import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe, PRICE_TO_PLAN, priceIdFor } from '@/lib/stripe';

export const runtime = 'nodejs';

// ── Stripe Checkout session creator ─────────────────────────────────────────
// POST { price_id, tenant_id, billing }  (billing kept for parity / metadata)
// Auth: caller sends their Supabase access token as `Authorization: Bearer`.
// We verify the token, confirm the user owns the tenant, reuse-or-create the
// Stripe customer, and open a subscription Checkout session with a 30-day trial.

const SUCCESS_URL = 'https://inlineiq.app/app/supervisor?subscribed=true';
const CANCEL_URL = 'https://inlineiq.app/pricing';

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

    // ── Auth ────────────────────────────────────────────────────────────────
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    // ── Input ─────────────────────────────────────────────────────────────────
    // Callers may pass either an explicit `price_id`, or a `tier` + `billing`
    // pair that we resolve to the configured price id server-side. tenant_id is
    // always required.
    let payload: { price_id?: string; tier?: string; tenant_id?: string; billing?: string };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { tenant_id } = payload;
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id required' }, { status: 400 });
    }
    const billing = payload.billing === 'annual' ? 'annual' : 'monthly';

    let price_id = payload.price_id;
    if (!price_id && payload.tier) {
      const tier = payload.tier === 'operations' ? 'operations' : payload.tier === 'shop' ? 'shop' : null;
      if (tier) price_id = priceIdFor(tier, billing) ?? undefined;
    }
    if (!price_id) {
      return NextResponse.json({ error: 'price_id or tier required' }, { status: 400 });
    }
    if (!PRICE_TO_PLAN[price_id]) {
      return NextResponse.json({ error: 'Unknown plan price' }, { status: 400 });
    }
    const plan = PRICE_TO_PLAN[price_id];

    // ── Tenant + ownership ────────────────────────────────────────────────────
    const { data: tenantData, error: tErr } = await db
      .from('tenants')
      .select('id, owner_user_id, owner_email, stripe_customer_id')
      .eq('id', tenant_id)
      .single();
    const tenant = tenantData as {
      id: string; owner_user_id: string | null; owner_email: string | null; stripe_customer_id: string | null;
    } | null;
    if (tErr || !tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    if (tenant.owner_user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Reuse-or-create Stripe customer ───────────────────────────────────────
    let customerId: string | null = tenant.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant.owner_email ?? userData.user.email ?? undefined,
        metadata: { tenant_id },
      });
      customerId = customer.id;
      await db.from('tenants').update({ stripe_customer_id: customerId }).eq('id', tenant_id);
    }

    // ── Checkout session ──────────────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: price_id, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { tenant_id, plan },
      },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { tenant_id, plan, billing },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 },
    );
  }
}
