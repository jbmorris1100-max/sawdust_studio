export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired';

export type PlanName =
  | 'trial'
  | 'shop_monthly'
  | 'shop_annual'
  | 'operations_monthly'
  | 'operations_annual'
  | 'cancelled'
  | 'expired';

export type Tenant = {
  id: string;
  shop_name: string;
  owner_email: string | null;
  owner_user_id: string | null;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  created_at: string;
  setup_complete: boolean | null;
  departments: string[] | null;
  // AI push-suggestion mode. Default 'learn' = no suggestions shown to crew.
  ai_mode: 'learn' | 'assist' | 'autonomous' | null;
  // ── Stripe billing (nullable until a subscription exists) ──
  plan: PlanName | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  // ── Supervisor PIN (hashed, set in Settings) ──
  supervisor_pin?: string | null;
  // ── Partner accounts (created via /admin/partners) ──
  is_partner?: boolean;
  partner_discount?: number;
  partner_trial_ends_at?: string | null;
};

// Display metadata per plan, mirrored from lib/stripe.ts PLAN_META so the client
// can render plan name + price without importing the server-only Stripe module.
// Keep these in sync.
export const PLAN_DISPLAY: Record<PlanName, { label: string; price: string; billing: 'monthly' | 'annual' | null }> = {
  trial:              { label: 'Trial',      price: 'Free trial',                    billing: null },
  shop_monthly:       { label: 'Shop',       price: '$599 / month',                  billing: 'monthly' },
  shop_annual:        { label: 'Shop',       price: '$499 / month, billed annually', billing: 'annual' },
  operations_monthly: { label: 'Operations', price: '$799 / month',                  billing: 'monthly' },
  operations_annual:  { label: 'Operations', price: '$665 / month, billed annually', billing: 'annual' },
  cancelled:          { label: 'Cancelled',  price: '—',                             billing: null },
  expired:            { label: 'Expired',    price: '—',                             billing: null },
};

export function planLabel(plan: PlanName | null): string {
  return plan ? PLAN_DISPLAY[plan]?.label ?? 'Trial' : 'Trial';
}

export function isPaidPlan(plan: PlanName | null): boolean {
  return !!plan && plan !== 'trial' && plan !== 'cancelled' && plan !== 'expired';
}

// Default departments used when a tenant has not customized its list.
export const DEFAULT_DEPARTMENTS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];

// Resolve the department list for a tenant, falling back to the defaults
// when departments is null/empty. Used by every department dropdown in the app.
export function getDepartments(tenant: Pick<Tenant, 'departments'> | null | undefined): string[] {
  const d = tenant?.departments;
  return Array.isArray(d) && d.length > 0 ? d : DEFAULT_DEPARTMENTS;
}

export function trialDaysLeft(trial_ends_at: string | null): number {
  if (!trial_ends_at) return 0;
  const ms = new Date(trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// A partner account is "active" while inside its partner trial window (or
// indefinitely if no end date is set). After the window, the partner keeps
// access through their normal subscription/trial state, but isPartnerActive
// flips to false so the supervisor can surface the lifetime-discount banner.
export function isPartnerActive(tenant: Tenant): boolean {
  if (!tenant.is_partner) return false;
  if (!tenant.partner_trial_ends_at) return true;
  return new Date(tenant.partner_trial_ends_at) > new Date();
}

export function isTenantExpired(tenant: Tenant): boolean {
  // Partners inside their partner trial never count as expired.
  if (isPartnerActive(tenant)) return false;
  // Paid + active, or past_due (kept in a grace window so they can fix billing)
  // both retain access; the supervisor shows a banner for past_due.
  if (tenant.subscription_status === 'active') return false;
  if (tenant.subscription_status === 'past_due') return false;
  if (tenant.subscription_status === 'trial') {
    return trialDaysLeft(tenant.trial_ends_at) === 0;
  }
  return true; // 'cancelled' | 'expired'
}
