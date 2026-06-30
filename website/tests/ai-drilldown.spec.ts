import { test, expect } from '@playwright/test';

/**
 * Supervisor → Overview → Production Pipeline → Job drill-down (Phase 8).
 *
 *   AUTO-DRILL is verified with FULLY SYNTHETIC data and is labeled as such
 *   everywhere below. There is NO real part_dept_events / ai_baselines data in any
 *   tenant yet (Stewart has completed no stages), so an honest auto-drill demo is
 *   impossible on real data — we seed a minimal, clearly-marked synthetic job.
 *
 *   Synthetic markers (all on the test tenant):
 *     • job_number  = 'E2E-DRILL-1'
 *     • crew        = 'E2E Drill Crew'
 *     • ai_baselines marker: job_type = 'E2E-DRILL' (real baselines use NULL)
 *   The gated cleanup script (scripts/cleanup-drilldown-test.mjs) removes all of
 *   it. NO automatic teardown here — seeded rows are left for human-reviewed
 *   cleanup, same pattern as every other phase.
 *
 *   What the synthetic job proves:
 *     - assist mode: the assembly stage is seeded at ~7h job dwell vs a 2h baseline
 *       (sample_count 10 ≥ MIN_SAMPLES), so the detector flags a bottleneck and the
 *       auto-walk surfaces the slowest cabinet (E2E-DR-2 @ 8h) and crew (E2E Drill
 *       Crew). All numbers come from the seeded DB rows — nothing fabricated.
 *     - learn mode: NO auto-drill panel; the manual breakdown still renders.
 *
 * Required env: TEST_BASE_URL (preview), VERCEL_AUTOMATION_BYPASS_SECRET (preview
 * protection bypass — applied as a header in playwright.config.ts), TEST_LOGIN_PASSWORD,
 * TEST_SUPERVISOR_PIN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';
const JOB = 'E2E-DRILL-1';
const CREW = 'E2E Drill Crew';
const BASELINE_MARKER = 'E2E-DRILL'; // ai_baselines.job_type marker (real rows use NULL)

const env = {
  baseURL: process.env.TEST_BASE_URL ?? '',
  email: process.env.TEST_LOGIN_EMAIL ?? 'user@inlineiq.app',
  password: process.env.TEST_LOGIN_PASSWORD ?? '',
  pin: process.env.TEST_SUPERVISOR_PIN ?? '',
  supaUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

// T0 = two days ago, so dwell windows sit fully in the past.
const T0 = new Date(Date.now() - 2 * 24 * 3600 * 1000);
const plusH = (base: Date, h: number) => new Date(base.getTime() + h * 3600 * 1000).toISOString();

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${env.supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}
function restReturn(path: string, body: unknown) {
  return rest(path, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) }).then((r) => r.json());
}
function setMode(mode: 'learn' | 'assist' | 'autonomous') {
  return rest(`tenants?id=eq.${TEST_TENANT}`, { method: 'PATCH', body: JSON.stringify({ ai_mode: mode }) });
}

async function login(page: import('@playwright/test').Page) {
  // Preview protection is bypassed via the automation-bypass header set globally
  // in playwright.config.ts — no per-run _vercel_share navigation needed.
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
}

test.describe('Supervisor · Job drill-down (Phase 8, SYNTHETIC auto-drill)', () => {
  test.beforeAll(async () => {
    expect(env.baseURL, 'TEST_BASE_URL must be the PREVIEW url').not.toBe('');
    expect(env.baseURL, 'refusing to run against production').not.toContain('inlineiq.app');
    expect(process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'VERCEL_AUTOMATION_BYPASS_SECRET must be set (preview protection bypass)').toBeTruthy();
    const missing = (['password', 'pin', 'supaUrl', 'serviceKey'] as const).filter((k) => !env[k]);
    expect(missing, `missing env: ${missing.join(', ')}`).toEqual([]);

    // 1. SYNTHETIC baseline: assembly avg 2h, sample_count 10 (≥ MIN_SAMPLES).
    //    job_type marker keeps it distinct from any real (NULL) baseline.
    expect((await rest('ai_baselines', { method: 'POST', body: JSON.stringify([
      { tenant_id: TEST_TENANT, stage: 'assembly', job_type: BASELINE_MARKER, avg_hours: 2.0, std_deviation: 0.5, sample_count: 10, calculated_at: T0.toISOString() },
    ]) })).ok).toBeTruthy();

    // 2. Two cabinets for the synthetic job.
    const cabs = await restReturn('cabinet_units', [
      { tenant_id: TEST_TENANT, job_number: JOB, cabinet_number: 'E2E-DR-1', unit_label: 'E2E Drill Cab 1', assigned_dept: 'assembly', status: 'in_assembly' },
      { tenant_id: TEST_TENANT, job_number: JOB, cabinet_number: 'E2E-DR-2', unit_label: 'E2E Drill Cab 2', assigned_dept: 'assembly', status: 'in_assembly' },
    ]) as { id: string; cabinet_number: string }[];
    expect(cabs.length).toBe(2);
    const cab1 = cabs.find((c) => c.cabinet_number === 'E2E-DR-1')!.id;
    const cab2 = cabs.find((c) => c.cabinet_number === 'E2E-DR-2')!.id;

    // 3. One part per cabinet.
    const parts = await restReturn('parts', [
      { tenant_id: TEST_TENANT, cabinet_unit_id: cab1, job_number: JOB, part_name: 'E2E Drill Part A', assigned_dept: 'assembly', production_status: 'in_progress', status: 'in_progress' },
      { tenant_id: TEST_TENANT, cabinet_unit_id: cab2, job_number: JOB, part_name: 'E2E Drill Part B', assigned_dept: 'assembly', production_status: 'in_progress', status: 'in_progress' },
    ]) as { id: string; cabinet_unit_id: string }[];
    expect(parts.length).toBe(2);
    const partA = parts.find((p) => p.cabinet_unit_id === cab1)!.id;
    const partB = parts.find((p) => p.cabinet_unit_id === cab2)!.id;

    // 4. Dept events → completed 'assembly' stages: part A 6h, part B 8h (avg 7h).
    //    Stage closes on the 'finishing' event whose worker is the attributed crew.
    const events = [
      // part A on cab1: assembly for 6h
      { tenant_id: TEST_TENANT, part_id: partA, cabinet_unit_id: cab1, job_number: JOB, from_dept: 'production', to_dept: 'assembly',  worker_name: 'E2E Cut', created_at: plusH(T0, 0) },
      { tenant_id: TEST_TENANT, part_id: partA, cabinet_unit_id: cab1, job_number: JOB, from_dept: 'assembly',   to_dept: 'finishing', worker_name: CREW,      created_at: plusH(T0, 6) },
      // part B on cab2: assembly for 8h (slowest cabinet)
      { tenant_id: TEST_TENANT, part_id: partB, cabinet_unit_id: cab2, job_number: JOB, from_dept: 'production', to_dept: 'assembly',  worker_name: 'E2E Cut', created_at: plusH(T0, 0) },
      { tenant_id: TEST_TENANT, part_id: partB, cabinet_unit_id: cab2, job_number: JOB, from_dept: 'assembly',   to_dept: 'finishing', worker_name: CREW,      created_at: plusH(T0, 8) },
    ];
    expect((await rest('part_dept_events', { method: 'POST', body: JSON.stringify(events) })).ok).toBeTruthy();
  });

  async function expandJob(page: import('@playwright/test').Page) {
    await page.waitForLoadState('networkidle');
    const row = page.getByRole('button').filter({ hasText: /drill/i }).first();
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    await row.click();
    await page.getByTestId('job-drilldown').waitFor({ state: 'visible', timeout: 20_000 });
  }

  test('assist mode: auto-drill flags the bottleneck and walks to cabinet + crew', async ({ page }) => {
    await setMode('assist');
    await login(page);
    await expandJob(page);

    const auto = page.getByTestId('auto-drill');
    await expect(auto, 'auto-drill panel present in assist mode').toBeVisible({ timeout: 20_000 });
    await expect(auto).toContainText('AI Bottleneck Analysis');
    await expect(auto).toContainText(/running slow/i);
    await expect(auto).toContainText(/assembly/i);
    // Auto-walk targets (real seeded values): slowest cabinet + crew.
    await expect(auto).toContainText('E2E-DR-2');     // slowest cabinet (8h)
    await expect(auto).toContainText(CREW);           // attributed crew
    await expect(auto).toContainText(/time-in-dept/i); // queue/wait-honest wording
  });

  test('learn mode: no auto-drill; manual breakdown still renders', async ({ page }) => {
    await setMode('learn');
    await login(page);
    await expandJob(page);

    // Manual path intact…
    const drill = page.getByTestId('job-drilldown');
    await expect(drill).toBeVisible();
    // …but no AI auto-analysis in learn mode.
    await expect(page.getByTestId('auto-drill')).toHaveCount(0);
    // Honesty: the static-threshold "Slow" qualifier is present (not AI-derived).
    await expect(drill).toContainText(/static threshold/i);
  });
});
