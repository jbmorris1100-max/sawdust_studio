import Stripe from 'stripe';

// ── Server-only Stripe client ───────────────────────────────────────────────
// Never import this from a client component — it carries the secret key.
// apiVersion is intentionally omitted so the SDK's pinned default is used,
// which keeps object shapes (e.g. items[].current_period_end) in sync with
// the installed stripe package and avoids type drift on upgrade.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');

// ── Plan model ──────────────────────────────────────────────────────────────
// A "plan" is the internal name we persist on tenants.plan. It encodes both the
// tier (Shop / Operations) and the billing period (monthly / annual). 'trial',
// 'cancelled' and 'expired' are lifecycle states with no Stripe price.
export type PlanName =
  | 'trial'
  | 'shop_monthly'
  | 'shop_annual'
  | 'operations_monthly'
  | 'operations_annual'
  | 'cancelled'
  | 'expired';

export type Tier = 'shop' | 'operations';
export type Billing = 'monthly' | 'annual';

type PlanMeta = {
  label: string;        // human tier name shown in UI/admin
  tier: Tier | null;
  billing: Billing | null;
  mrr: number;          // monthly recurring revenue contribution in dollars
  priceLabel: string;   // short price string for billing UI
};

export const PLAN_META: Record<PlanName, PlanMeta> = {
  trial:              { label: 'Trial',      tier: null,        billing: null,      mrr: 0,        priceLabel: 'Free trial' },
  shop_monthly:       { label: 'Shop',       tier: 'shop',      billing: 'monthly', mrr: 599,      priceLabel: '$599 / month' },
  // Annual plans are billed yearly; mrr is the monthly-equivalent for reporting.
  shop_annual:        { label: 'Shop',       tier: 'shop',      billing: 'annual',  mrr: 5990 / 12, priceLabel: '$499 / month, billed annually' },
  operations_monthly: { label: 'Operations', tier: 'operations', billing: 'monthly', mrr: 799,     priceLabel: '$799 / month' },
  operations_annual:  { label: 'Operations', tier: 'operations', billing: 'annual',  mrr: 7990 / 12, priceLabel: '$665 / month, billed annually' },
  cancelled:          { label: 'Cancelled',  tier: null,        billing: null,      mrr: 0,        priceLabel: '—' },
  expired:            { label: 'Expired',    tier: null,        billing: null,      mrr: 0,        priceLabel: '—' },
};

// Map a Stripe price id → internal plan name. Used by the webhook to keep
// tenants.plan in sync when a subscription is created or changed.
// Env values are trimmed because pasting price ids into Vercel can introduce
// trailing whitespace or newlines, which would break the id → plan lookup.
export const PRICE_TO_PLAN: Record<string, PlanName> = {
  [(process.env.STRIPE_SHOP_MONTHLY_PRICE_ID ?? '').trim()]:       'shop_monthly',
  [(process.env.STRIPE_SHOP_ANNUAL_PRICE_ID ?? '').trim()]:        'shop_annual',
  [(process.env.STRIPE_OPERATIONS_MONTHLY_PRICE_ID ?? '').trim()]: 'operations_monthly',
  [(process.env.STRIPE_OPERATIONS_ANNUAL_PRICE_ID ?? '').trim()]:  'operations_annual',
};

// Resolve a {tier, billing} selection → the configured Stripe price id.
// Returns null when the matching env var is not set.
export function priceIdFor(tier: Tier, billing: Billing): string | null {
  const key =
    tier === 'shop'
      ? billing === 'annual' ? 'STRIPE_SHOP_ANNUAL_PRICE_ID' : 'STRIPE_SHOP_MONTHLY_PRICE_ID'
      : billing === 'annual' ? 'STRIPE_OPERATIONS_ANNUAL_PRICE_ID' : 'STRIPE_OPERATIONS_MONTHLY_PRICE_ID';
  return (process.env[key] ?? '').trim() || null;
}

// Map a Stripe subscription status → our internal subscription_status enum.
export function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return status === 'trialing' ? 'trial' : 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return 'active';
  }
}

// Pull current_period_end off a subscription. In the current Stripe API version
// this lives on the subscription item, not the subscription object itself.
export function periodEndOf(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0];
  return item?.current_period_end ?? null;
}
