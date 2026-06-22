import { test, expect, type Locator } from '@playwright/test';

/**
 * Supervisor → Sort List → assign a queued unit to a department.
 *
 * End-to-end happy path:
 *   login → supervisor PIN → Sort List tab → find the seeded entry →
 *   pick a department → Assign → assert the entry leaves the queue.
 *
 * Test data: run `node scripts/seed-sort-list-entry.mjs` first; it prints the
 * TEST_CABINET_UNIT_ID / TEST_UNIT_LABEL to export. See tests/README.md.
 *
 * All inputs come from env vars so this is reusable, not a one-off:
 *   TEST_CABINET_UNIT_ID  (required) the seeded unit's id
 *   TEST_UNIT_LABEL       (required) the seeded unit's label — used to find the
 *                         row on the LIVE site, which won't carry the
 *                         data-cabinet-unit-id hook until this branch deploys
 *   TEST_SUPERVISOR_PIN   (required) supervisor PIN for the test tenant
 *   TEST_LOGIN_EMAIL      (default user@inlineiq.app) tenant owner login
 *   TEST_LOGIN_PASSWORD   (required) login password
 *   TEST_TENANT_ID        (default = the test tenant; a guard refuses any other)
 */

// The ONE tenant these mutating specs are allowed to touch.
const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';

const env = {
  tenantId: process.env.TEST_TENANT_ID ?? TEST_TENANT,
  email: process.env.TEST_LOGIN_EMAIL ?? 'user@inlineiq.app',
  password: process.env.TEST_LOGIN_PASSWORD ?? '',
  pin: process.env.TEST_SUPERVISOR_PIN ?? '',
  cabinetUnitId: process.env.TEST_CABINET_UNIT_ID ?? '',
  unitLabel: process.env.TEST_UNIT_LABEL ?? '',
};

test.describe('Supervisor · Sort List', () => {
  test.beforeAll(() => {
    // Safety: never let this run against a real customer tenant.
    expect(
      env.tenantId,
      `Refusing to run: TEST_TENANT_ID must be the test tenant (${TEST_TENANT}).`,
    ).toBe(TEST_TENANT);

    const missing = (['password', 'pin', 'cabinetUnitId', 'unitLabel'] as const)
      .filter((k) => !env[k]);
    expect(missing, `Missing required env vars: ${missing.join(', ')}`).toEqual([]);
  });

  test('assigns a queued unit to a department and removes it from the list', async ({ page }) => {
    // ── 1. Log in (tenant owner) ──────────────────────────────────────────────
    await page.goto('/login');
    await page.locator('#email').fill(env.email);
    await page.locator('#password').fill(env.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/app', { timeout: 20_000 });

    // ── 2. Supervisor PIN gate ────────────────────────────────────────────────
    await page.goto('/app/supervisor-pin');
    const pinInput = page.locator('input[type="password"]');
    await pinInput.waitFor({ state: 'visible', timeout: 20_000 });
    await pinInput.fill(env.pin);
    await page.getByRole('button', { name: 'Enter', exact: true }).click();
    await page.waitForURL('**/app/supervisor', { timeout: 20_000 });

    // ── 3. Open the Sort List tab (desktop sidebar) ───────────────────────────
    await page.locator('aside.sup-sidebar')
      .getByRole('button', { name: 'Sort List' })
      .click();
    await expect(page.getByRole('heading', { name: 'Sort List' })).toBeVisible();

    // ── 4. Find the seeded entry ──────────────────────────────────────────────
    // Prefer the stable data hook (present once this branch deploys); fall back
    // to the visible unit label so the test works against the current live site.
    const row: Locator = page
      .locator(`[data-cabinet-unit-id="${env.cabinetUnitId}"]`)
      .or(page.locator('.portal-card').filter({ hasText: env.unitLabel }))
      .first();
    await expect(row, 'seeded Sort List entry should be present').toBeVisible({ timeout: 20_000 });

    // ── 5. Pick a department + Assign ─────────────────────────────────────────
    // index 0 is the disabled "Assign to…" placeholder; index 1 is the first
    // real department (tenant-config dependent, so chosen by position not name).
    await row.locator('select').selectOption({ index: 1 });
    await row.getByRole('button', { name: 'Assign' }).click();

    // ── 6. Assert it left the queue ───────────────────────────────────────────
    // Success toast renders "<unit label> → <Department>"; its presence confirms
    // the assign succeeded (not just an optimistic removal that later reverts).
    await expect(page.getByText(`${env.unitLabel} →`)).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(`[data-cabinet-unit-id="${env.cabinetUnitId}"]`)
        .or(page.locator('.portal-card').filter({ hasText: env.unitLabel })),
      'assigned entry should be gone from the Sort List',
    ).toHaveCount(0, { timeout: 20_000 });
  });
});
