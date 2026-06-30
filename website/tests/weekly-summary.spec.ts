import { test, expect } from '@playwright/test';

/**
 * Supervisor → Reports → Weekly Summary (Phase 7) — the two new charts.
 *
 *   login → PIN → Reports → Weekly Summary → assert the per-job legend + both
 *   grouped charts render, and that Damage / Inventory are NOT shown here.
 *
 * Stewart has no weekly activity, so we seed a tiny synthetic 2-job week (two
 * throwaway completed cabinets per job + a few time_clock rows) for TODAY, which
 * the default week picker covers. NO automatic teardown — seeded rows are left for
 * a human-reviewed cleanup (scripts/cleanup-weekly-test.mjs).
 *
 * Required env: TEST_BASE_URL (preview), TEST_VERCEL_SHARE, TEST_LOGIN_PASSWORD,
 * TEST_SUPERVISOR_PIN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const JOB_A = 'E2E-WK-A';
const JOB_B = 'E2E-WK-B';

const env = {
  baseURL: process.env.TEST_BASE_URL ?? '',
  share: process.env.TEST_VERCEL_SHARE ?? '',
  email: process.env.TEST_LOGIN_EMAIL ?? 'user@inlineiq.app',
  password: process.env.TEST_LOGIN_PASSWORD ?? '',
  pin: process.env.TEST_SUPERVISOR_PIN ?? '',
  supaUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

const today = new Date().toISOString().slice(0, 10);
const nowISO = new Date().toISOString();

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${env.supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

test.describe('Supervisor · Weekly Summary', () => {
  test.beforeAll(async () => {
    expect(env.baseURL, 'TEST_BASE_URL must be the PREVIEW url').not.toBe('');
    expect(env.baseURL, 'refusing to run against production').not.toContain('inlineiq.app');
    const missing = (['share', 'password', 'pin', 'supaUrl', 'serviceKey'] as const).filter((k) => !env[k]);
    expect(missing, `missing env: ${missing.join(', ')}`).toEqual([]);

    // Viz 1 source: completed cabinets (output) — 2 for JOB_A, 1 for JOB_B, today.
    const cabs = [
      { job: JOB_A }, { job: JOB_A }, { job: JOB_B },
    ].map((c, i) => ({
      tenant_id: TEST_TENANT, job_number: c.job, status: 'complete', completed_at: nowISO,
      unit_label: `E2E WK ${c.job} ${i}`, cabinet_number: `E2EWK-${Date.now()}-${i}`,
    }));
    expect((await rest('cabinet_units', { method: 'POST', body: JSON.stringify(cabs) })).ok).toBeTruthy();

    // Viz 2 source: labor hours — JOB_A 5h Assembly + 3h Finishing, JOB_B 8h Assembly.
    const tc = [
      { job_number: JOB_A, dept: 'Assembly', total_hours: 5 },
      { job_number: JOB_A, dept: 'Finishing', total_hours: 3 },
      { job_number: JOB_B, dept: 'Assembly', total_hours: 8 },
    ].map((r) => ({ tenant_id: TEST_TENANT, worker_name: 'E2E WK', clock_in: nowISO, clock_out: nowISO, date: today, status: 'complete', ...r }));
    expect((await rest('time_clock', { method: 'POST', body: JSON.stringify(tc) })).ok).toBeTruthy();
  });

  test('renders per-job legend + both grouped charts; excludes damage/inventory', async ({ page }) => {
    await page.goto(`/?_vercel_share=${env.share}`, { waitUntil: 'domcontentloaded' });
    await page.goto('/login');
    await page.locator('#email').fill(env.email);
    await page.locator('#password').fill(env.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/app', { timeout: 20_000 });
    await page.goto('/app/supervisor-pin');
    const pin = page.locator('input[type="password"]');
    await pin.waitFor({ state: 'visible', timeout: 20_000 });
    await pin.fill(env.pin);
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.waitForURL('**/app/supervisor', { timeout: 20_000 });

    await page.locator('aside.sup-sidebar').getByRole('button', { name: 'Reports' }).click();
    await page.getByRole('button', { name: 'Weekly Summary', exact: true }).click();

    // Legend lists both jobs (one color each).
    const legend = page.getByTestId('weekly-legend');
    await expect(legend).toBeVisible({ timeout: 20_000 });
    await expect(legend).toContainText(JOB_A);
    await expect(legend).toContainText(JOB_B);

    // Both grouped charts rendered (not the empty state).
    await expect(page.getByTestId('weekly-viz1'), 'daily output chart').toBeVisible();
    await expect(page.getByTestId('weekly-viz2'), 'dept time chart').toBeVisible();

    // Damage + Inventory are intentionally NOT in the Weekly Summary itself
    // (they each have their own tab). Scope to the Weekly Summary panel — the
    // surrounding supervisor shell may show an "Open Damage" indicator elsewhere.
    const panel = page.getByTestId('weekly-summary');
    await expect(panel.getByText('Open Damage')).toHaveCount(0);
    await expect(panel.getByText('Pending Inventory')).toHaveCount(0);
  });
});
