import AsyncStorage from '@react-native-async-storage/async-storage';

const TENANT_KEY = '@inline_tenant';

export async function storeTenant(tenantData) {
  await AsyncStorage.setItem(TENANT_KEY, JSON.stringify(tenantData));
}

export async function getTenant() {
  try {
    const raw = await AsyncStorage.getItem(TENANT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearTenant() {
  await AsyncStorage.removeItem(TENANT_KEY);
}

export async function getTenantId() {
  const tenant = await getTenant();
  return tenant?.id ?? null;
}

export async function isTrialExpired() {
  const tenant = await getTenant();
  if (!tenant) return false;
  if (tenant.subscription_status === 'active') return false;
  if (!tenant.trial_ends_at) return false;
  return new Date(tenant.trial_ends_at) < new Date();
}
