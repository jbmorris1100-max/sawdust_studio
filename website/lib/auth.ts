export type Tenant = {
  id: string;
  shop_name: string;
  owner_email: string | null;
  owner_user_id: string | null;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired';
  trial_ends_at: string | null;
  created_at: string;
  setup_complete: boolean | null;
  departments: string[] | null;
};

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

export function isTenantExpired(tenant: Tenant): boolean {
  if (tenant.subscription_status === 'active') return false;
  if (tenant.subscription_status === 'trial') {
    return trialDaysLeft(tenant.trial_ends_at) === 0;
  }
  return true; // 'cancelled' | 'expired'
}
