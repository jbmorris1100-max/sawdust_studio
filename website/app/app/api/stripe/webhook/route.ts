import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { stripe, PRICE_TO_PLAN, mapStripeStatus, periodEndOf } from '@/lib/stripe';

// Webhooks need the raw request body for signature verification, so this must
// run on the Node runtime and never be statically cached. (Note: the Pages
// Router `export const config = { api: { bodyParser: false } }` does NOT apply
// in the App Router — we read the raw body with req.text() instead.)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type Db = NonNullable<ReturnType<typeof serviceDb>>;

const iso = (unixSeconds: number | null): string | null =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

// Resolve our tenant id from whatever identifiers an event carries: explicit
// metadata first, then the Stripe subscription/customer ids we persisted.
async function resolveTenantId(
  db: Db,
  opts: { metadataTenantId?: string | null; subscriptionId?: string | null; customerId?: string | null },
): Promise<string | null> {
  if (opts.metadataTenantId) return opts.metadataTenantId;
  if (opts.subscriptionId) {
    const { data } = await db.from('tenants').select('id').eq('stripe_subscription_id', opts.subscriptionId).maybeSingle();
    const row = data as { id: string } | null;
    if (row?.id) return row.id;
  }
  if (opts.customerId) {
    const { data } = await db.from('tenants').select('id').eq('stripe_customer_id', opts.customerId).maybeSingle();
    const row = data as { id: string } | null;
    if (row?.id) return row.id;
  }
  return null;
}

// Fire a supervisor push via the existing notify route (best-effort).
async function pushSupervisor(origin: string, tenant_id: string, title: string, body: string, url: string) {
  try {
    await fetch(`${origin}/app/api/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id, target: 'supervisor', title, body, url }),
    });
  } catch (err) {
    console.error('Webhook push failed:', err);
  }
}

export async function POST(req: Request) {
  // Trimmed to tolerate whitespace/newlines introduced when pasting into Vercel.
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 500 });
  }
  const db = serviceDb();
  if (!db) {
    return NextResponse.json({ error: 'Supabase service role not configured' }, { status: 500 });
  }

  // ── Verify signature against the raw body ──────────────────────────────────
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: unknown) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;

  try {
    switch (event.type) {
      // ── New subscription via Checkout ─────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenant_id = await resolveTenantId(db, {
          metadataTenantId: session.metadata?.tenant_id,
          customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        });
        if (!tenant_id) break;

        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
        const update: Record<string, unknown> = {
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          stripe_subscription_id: subscriptionId,
          subscription_status: 'active',
          plan: session.metadata?.plan ?? 'shop_monthly',
        };

        // Fetch the subscription to capture price + period end.
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price.id;
          if (priceId) {
            update.stripe_price_id = priceId;
            if (PRICE_TO_PLAN[priceId]) update.plan = PRICE_TO_PLAN[priceId];
          }
          update.current_period_end = iso(periodEndOf(sub));
          update.cancel_at_period_end = sub.cancel_at_period_end;
          // A subscription created with a trial reports status 'trialing'.
          update.subscription_status = mapStripeStatus(sub.status);
        }

        await db.from('tenants').update(update).eq('id', tenant_id);
        break;
      }

      // ── Plan / status changes ─────────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const tenant_id = await resolveTenantId(db, {
          metadataTenantId: sub.metadata?.tenant_id,
          subscriptionId: sub.id,
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        });
        if (!tenant_id) break;

        const priceId = sub.items.data[0]?.price.id ?? null;
        const update: Record<string, unknown> = {
          stripe_subscription_id: sub.id,
          stripe_price_id: priceId,
          subscription_status: mapStripeStatus(sub.status),
          current_period_end: iso(periodEndOf(sub)),
          cancel_at_period_end: sub.cancel_at_period_end,
        };
        if (priceId && PRICE_TO_PLAN[priceId]) update.plan = PRICE_TO_PLAN[priceId];
        await db.from('tenants').update(update).eq('id', tenant_id);
        break;
      }

      // ── Subscription ended ────────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenant_id = await resolveTenantId(db, {
          metadataTenantId: sub.metadata?.tenant_id,
          subscriptionId: sub.id,
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        });
        if (!tenant_id) break;
        await db.from('tenants').update({
          subscription_status: 'cancelled',
          plan: 'cancelled',
          cancel_at_period_end: false,
        }).eq('id', tenant_id);
        break;
      }

      // ── Payment failed → past_due + notify ────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const details = invoice.parent?.subscription_details ?? null;
        const subRef = details?.subscription;
        const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id ?? null;
        const tenant_id = await resolveTenantId(db, {
          metadataTenantId: details?.metadata?.tenant_id,
          subscriptionId,
          customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
        });
        if (!tenant_id) break;

        await db.from('tenants').update({ subscription_status: 'past_due' }).eq('id', tenant_id);
        await pushSupervisor(
          origin,
          tenant_id,
          'Payment failed',
          'Payment failed — update your billing info to keep your shop running',
          '/billing',
        );
        break;
      }

      // ── Payment succeeded → active + refresh period end ───────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const details = invoice.parent?.subscription_details ?? null;
        const subRef = details?.subscription;
        const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id ?? null;
        const tenant_id = await resolveTenantId(db, {
          metadataTenantId: details?.metadata?.tenant_id,
          subscriptionId,
          customerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
        });
        if (!tenant_id) break;

        const update: Record<string, unknown> = { subscription_status: 'active' };
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          update.subscription_status = mapStripeStatus(sub.status);
          update.current_period_end = iso(periodEndOf(sub));
          const priceId = sub.items.data[0]?.price.id;
          if (priceId) {
            update.stripe_price_id = priceId;
            if (PRICE_TO_PLAN[priceId]) update.plan = PRICE_TO_PLAN[priceId];
          }
        }
        await db.from('tenants').update(update).eq('id', tenant_id);
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    console.error('Webhook handler error:', event.type, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook handler failed' },
      { status: 500 },
    );
  }
}
