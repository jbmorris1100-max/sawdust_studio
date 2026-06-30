import { test, expect } from '@playwright/test';

/**
 * Supervisor → Reports → Rework — the Phase 6 confirm/correct flow, end to end.
 *
 *   login → PIN → Reports → Rework → "Scan now" (detects the seeded backward
 *   bounces) → click "Normal, don't flag again" on one card and "Log it" on the
 *   other → assert the real DB writes land + the suppression closes the loop.
 *
 * Seeds two backward part_dept_events for the test tenant (a real cabinet, two
 * throwaway parts with a per-run random token so re-runs never collide). "Scan
 * now" turns them into pending ai_rework_events. NO automatic teardown — seeded
 * rows are left for a human-reviewed cleanup (scripts/cleanup-rework-test.mjs).
 *
 * Required env (website/.env.local + .env.e2e + CLI):
 *   TEST_BASE_URL              preview url (a guard refuses production)
 *   VERCEL_AUTOMATION_BYPASS_SECRET  preview protection bypass (sent as a header in playwright.config.ts)
 *   TEST_LOGIN_PASSWORD, TEST_SUPERVISOR_PIN
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const REAL_CABINET = '73b37e18-fbff-4b42-853b-a7df143eed93'; // a real Stewart cabinet (for the card label)

const env = {
  baseURL: process.env.TEST_BASE_URL ?? '',
  email: process.env.TEST_LOGIN_EMAIL ?? 'user@inlineiq.app',
  password: process.env.TEST_LOGIN_PASSWORD ?? '',
  pin: process.env.TEST_SUPERVISOR_PIN ?? '',
  supaUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

// per-run token of LETTERS only (patternFromPartName strips digits, so digits
// couldn't make the suppression pattern unique).
const RUN = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
const ALPHA = `E2E Rework Alpha ${RUN}`;  // assembly -> production
const BETA = `E2E Rework Beta ${RUN}`;    // finishing -> assembly
const ALPHA_PATTERN = `rework alpha ${RUN}`;
let alphaPartId = '', betaPartId = '';

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${env.supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
async function seedPart(name: string): Promise<string> {
  const res = await rest('parts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ tenant_id: TEST_TENANT, cabinet_unit_id: REAL_CABINET, job_number: 'Stewart', part_name: name, status: 'pending' }),
  });
  const rows = (await res.json()) as { id: string }[];
  expect(res.ok, `seed part failed: ${JSON.stringify(rows)}`).toBeTruthy();
  return rows[0].id;
}
async function seedEvent(partId: string, from: string, to: string) {
  const res = await rest('part_dept_events', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: TEST_TENANT, part_id: partId, cabinet_unit_id: REAL_CABINET, job_number: 'Stewart', from_dept: from, to_dept: to, worker_name: 'E2E' }),
  });
  expect(res.ok, `seed event failed: ${await res.text()}`).toBeTruthy();
}

test.describe('Supervisor · Rework confirm/correct', () => {
  test.beforeAll(async () => {
    expect(env.baseURL, 'TEST_BASE_URL must be set to the PREVIEW url').not.toBe('');
    expect(env.baseURL, 'refusing to run against production').not.toContain('inlineiq.app');
    expect(process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'VERCEL_AUTOMATION_BYPASS_SECRET must be set (preview protection bypass)').toBeTruthy();
    const missing = (['password', 'pin', 'supaUrl', 'serviceKey'] as const).filter((k) => !env[k]);
    expect(missing, `missing env: ${missing.join(', ')}`).toEqual([]);
    alphaPartId = await seedPart(ALPHA);
    betaPartId = await seedPart(BETA);
    await seedEvent(alphaPartId, 'assembly', 'production'); // backward
    await seedEvent(betaPartId, 'finishing', 'assembly');   // backward
  });

  test('Normal suppresses; Log it writes a supervisor damage row', async ({ page }) => {
    // 0. Preview protection bypassed via the automation-bypass header (playwright.config.ts).
    // 1. Login + supervisor PIN.
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

    // 2. Reports → Rework.
    await page.locator('aside.sup-sidebar').getByRole('button', { name: 'Reports' }).click();
    await page.getByRole('button', { name: 'Rework', exact: true }).click();
    await expect(page.getByTestId('rework-panel')).toBeVisible();

    // 3. Scan now → the two seeded bounces become pending cards.
    await page.getByTestId('rework-scan').click();
    const alphaCard = page.getByTestId('rework-card').filter({ hasText: ALPHA });
    const betaCard = page.getByTestId('rework-card').filter({ hasText: BETA });
    await expect(alphaCard, 'Alpha pending card should render after scan').toBeVisible({ timeout: 20_000 });
    await expect(betaCard).toBeVisible({ timeout: 20_000 });

    // 4. "Normal, don't flag again" on Alpha.
    await alphaCard.getByTestId('rework-normal').click();
    await expect(alphaCard).toHaveCount(0, { timeout: 20_000 });

    // 4a. Suppression row landed (assembly → production, alpha pattern).
    const supRes = await rest(`ai_rework_suppressions?tenant_id=eq.${TEST_TENANT}&from_dept=eq.assembly&to_dept=eq.production&part_name_pattern=eq.${encodeURIComponent(ALPHA_PATTERN)}&select=*`);
    const sup = (await supRes.json()) as unknown[];
    expect(sup.length, 'a suppression row should exist for the alpha pattern').toBe(1);

    // 4b. Alpha events flipped to dismissed.
    const aEv = await (await rest(`ai_rework_events?tenant_id=eq.${TEST_TENANT}&part_id=eq.${alphaPartId}&select=status`)).json() as { status: string }[];
    expect(aEv.length).toBeGreaterThan(0);
    expect(aEv.every((e) => e.status === 'dismissed'), 'alpha events should be dismissed').toBeTruthy();

    // 4c. Follow-up detect-rework now SUPPRESSES that pattern.
    const scan = await page.request.post(`${env.baseURL}/app/api/detect-rework`, { data: { tenantId: TEST_TENANT, dryRun: true } });
    const scanJson = await scan.json();
    expect(scanJson.suppressedByRule, 'detect-rework should now suppress the alpha pattern').toBeGreaterThanOrEqual(1);

    // 5. "Log it" on Beta — category + notes.
    await betaCard.getByTestId('rework-log').click();
    await betaCard.getByTestId('rework-category').selectOption('wrong_dimensions');
    await betaCard.getByTestId('rework-notes').fill('E2E: beta panel cut 1/4in short');
    await betaCard.getByTestId('rework-log-submit').click();
    await expect(betaCard).toHaveCount(0, { timeout: 20_000 });

    // 5a. damage_reports row landed with the new columns.
    const dmg = await (await rest(`damage_reports?tenant_id=eq.${TEST_TENANT}&logged_by_role=eq.supervisor&part_name=like.*${RUN}*&select=report_type,logged_by_role,rework_category,notes`)).json() as { report_type: string; logged_by_role: string; rework_category: string; notes: string }[];
    expect(dmg.length, 'one supervisor damage row for beta').toBe(1);
    expect(dmg[0].report_type).toBe('damage');
    expect(dmg[0].logged_by_role).toBe('supervisor');
    expect(dmg[0].rework_category).toBe('wrong_dimensions');

    // 5b. Beta events flipped to confirmed.
    const bEv = await (await rest(`ai_rework_events?tenant_id=eq.${TEST_TENANT}&part_id=eq.${betaPartId}&select=status`)).json() as { status: string }[];
    expect(bEv.length).toBeGreaterThan(0);
    expect(bEv.every((e) => e.status === 'confirmed'), 'beta events should be confirmed').toBeTruthy();
  });
});
