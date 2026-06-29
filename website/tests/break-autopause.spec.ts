import { test, expect } from '@playwright/test';

/**
 * Crew · break auto-pause / resume (Phase "item 3").
 *
 * Verifies the new break behaviour end-to-end against a PREVIEW deployment:
 *   clock in → (active build present) → Start Break (auto-pauses the build,
 *   folding the live session into accumulated_seconds) → confirm the value is
 *   FROZEN while paused → End Break → the "Unfinished project" resume prompt
 *   renders → Resume → confirm work CONTINUED (accumulated_seconds preserved,
 *   not reset to 0).
 *
 * The active build is the precondition, not the thing under test. Pegasus has no
 * unit currently queued into a dept (all cabinet_units are `pending`), and the
 * live "start build" path differs per dept template, so we seed the exact
 * crew_active_projects row a real start produces — pointed at a REAL Pegasus
 * cabinet_unit — via the service role. The break auto-pause reads that row by
 * worker_name, so this faithfully exercises the new crew/page.tsx code; only the
 * Start Break / End Break / Resume clicks below drive the real preview UI.
 *
 * Required env (sourced from website/.env.local + .env.e2e at run time):
 *   TEST_BASE_URL                 the preview URL (NOT production)
 *   TEST_LOGIN_PASSWORD           password for the tenant owner (user@inlineiq.app)
 *   NEXT_PUBLIC_SUPABASE_URL      Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     service role key (seed + query + cleanup)
 *   TEST_LOGIN_EMAIL              (default user@inlineiq.app)
 */

const TEST_TENANT = 'b69e7a5e-ea31-4b2d-a413-b32cb8f0289f';

// A REAL Pegasus cabinet_unit (job "Stewart"). The build attaches to this unit.
const REAL_UNIT_ID = '73b37e18-fbff-4b42-853b-a7df143eed93';
const REAL_UNIT_LABEL = '1 — KW Tall Filler UM Pnl';
const REAL_JOB = 'Stewart';

// Throwaway crew identity — unique per run so cleanup is unambiguous.
const WORKER = `E2E-BREAK ${new Date().toISOString().replace(/[:.]/g, '-')}`;
// Seed a build that has been running ~120s so the frozen value is clearly > 0.
const SEEDED_SESSION_AGE_S = 120;

const env = {
  baseURL: process.env.TEST_BASE_URL ?? '',
  email: process.env.TEST_LOGIN_EMAIL ?? 'user@inlineiq.app',
  password: process.env.TEST_LOGIN_PASSWORD ?? '',
  supaUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

// ── Minimal PostgREST helper (service role, tenant-scoped) ───────────────────
function rest(path: string, init: RequestInit = {}) {
  return fetch(`${env.supaUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function queryProject(): Promise<{ accumulated_seconds: number; status: string; session_start: string | null } | null> {
  const res = await rest(
    `crew_active_projects?tenant_id=eq.${TEST_TENANT}&worker_name=eq.${encodeURIComponent(WORKER)}` +
      `&select=accumulated_seconds,status,session_start`,
  );
  const rows = (await res.json()) as Array<{ accumulated_seconds: number; status: string; session_start: string | null }>;
  return rows[0] ?? null;
}

async function cleanup() {
  const today = new Date().toISOString().split('T')[0];
  await rest(`crew_active_projects?tenant_id=eq.${TEST_TENANT}&worker_name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' });
  await rest(`time_clock?tenant_id=eq.${TEST_TENANT}&worker_name=eq.${encodeURIComponent(WORKER)}&date=eq.${today}`, { method: 'DELETE' });
}

test.describe('Crew · break auto-pause / resume', () => {
  test.beforeAll(() => {
    expect(env.baseURL, 'TEST_BASE_URL must be set to the PREVIEW url').not.toBe('');
    expect(env.baseURL, 'refusing to run against production').not.toContain('inlineiq.app');
    const missing = (['password', 'supaUrl', 'serviceKey'] as const).filter((k) => !env[k]);
    expect(missing, `missing env: ${missing.join(', ')}`).toEqual([]);
  });

  // Leave the test tenant exactly as we found it, pass or fail.
  test.afterAll(async () => { await cleanup(); });

  test('break freezes accumulated_seconds; resume continues without reset', async ({ page }) => {
    // ── 0a. Prime the Vercel Deployment-Protection bypass cookie ───────────────
    // The preview is behind Vercel Authentication; visiting the _vercel_share
    // link once sets a JWT cookie that authorizes the rest of the run.
    const share = process.env.TEST_VERCEL_SHARE;
    if (share) {
      await page.goto(`/?_vercel_share=${share}`, { waitUntil: 'domcontentloaded' });
    }

    // ── 0. Seed the active build (real unit) — the precondition ────────────────
    await cleanup(); // clear any stale row for this worker
    const sessionStart = new Date(Date.now() - SEEDED_SESSION_AGE_S * 1000).toISOString();
    const seedRes = await rest('crew_active_projects', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: TEST_TENANT,
        worker_name: WORKER,
        dept: 'craftsman',
        cabinet_unit_id: REAL_UNIT_ID,
        unit_label: REAL_UNIT_LABEL,
        job_number: REAL_JOB,
        time_clock_id: null,
        session_start: sessionStart,
        accumulated_seconds: 0,
        status: 'active',
        updated_at: new Date().toISOString(),
      }),
    });
    expect(seedRes.ok, `seed failed: ${seedRes.status} ${await seedRes.text()}`).toBeTruthy();

    // ── 1. Log in as the tenant owner (crew page resolves tenant via session) ──
    await page.goto('/login');
    await page.locator('#email').fill(env.email);
    await page.locator('#password').fill(env.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/app', { timeout: 20_000 });

    // ── 2. Crew dashboard ──────────────────────────────────────────────────────
    await page.goto('/app/crew');
    const clockCard = page.getByText('Clock In / Out', { exact: true }).first();
    await expect(clockCard).toBeVisible({ timeout: 20_000 });

    // ── 3. Clock in (throwaway name + first dept) ──────────────────────────────
    await clockCard.click();
    await page.getByPlaceholder('e.g. Mike Torres').fill(WORKER);
    await page.getByRole('button', { name: 'Look Up Status' }).click();
    // No open shift → clock-in step. Pick the first real department.
    await page.locator('select.form-input').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Clock In', exact: true }).click();
    await expect(page.getByText(`${WORKER} clocked in`)).toBeVisible({ timeout: 20_000 });

    const beforeBreak = await queryProject();
    expect(beforeBreak?.status, 'seeded build should be active before break').toBe('active');

    // ── 4. Start Break → new code auto-pauses the active build ─────────────────
    await clockCard.click();
    const startBreakBtn = page.getByRole('button', { name: 'Start Break' });
    await expect(startBreakBtn).toBeVisible({ timeout: 20_000 });
    await startBreakBtn.click();
    // Toast confirms the auto-pause fired with the real unit label.
    await expect(page.getByText(`${REAL_UNIT_LABEL} paused for break`)).toBeVisible({ timeout: 20_000 });

    // accumulated_seconds is now the FROZEN folded value.
    const paused1 = await queryProject();
    expect(paused1?.status, 'project should be paused on break').toBe('paused');
    expect(paused1?.session_start, 'no live session while paused').toBeNull();
    const frozen = paused1?.accumulated_seconds ?? -1;
    expect(frozen, 'folded ~120s session should be > 100').toBeGreaterThan(100);

    // ── 5. Confirm FROZEN — value does not accrue while paused ─────────────────
    await page.waitForTimeout(4000);
    const paused2 = await queryProject();
    expect(paused2?.accumulated_seconds, 'paused value must not grow').toBe(frozen);

    // ── 6. End Break → resume prompt renders ───────────────────────────────────
    await clockCard.click();
    const endBreakBtn = page.getByRole('button', { name: 'End Break' });
    await expect(endBreakBtn).toBeVisible({ timeout: 20_000 });
    await endBreakBtn.click();

    // The "Unfinished project" resume modal must render.
    await expect(page.getByText('Unfinished project')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(REAL_UNIT_LABEL, { exact: true })).toBeVisible();
    const resumeBtn = page.getByRole('button', { name: 'Resume Build' });
    await expect(resumeBtn).toBeVisible();

    // ── 7. Resume → work CONTINUES (accumulated_seconds preserved, not reset) ──
    await resumeBtn.click();
    await expect(page.getByText(`${REAL_UNIT_LABEL} resumed`)).toBeVisible({ timeout: 20_000 });

    const afterResume = await queryProject();
    expect(afterResume?.status, 'should be active again after resume').toBe('active');
    expect(afterResume?.session_start, 'fresh session opened on resume').not.toBeNull();
    expect(
      afterResume?.accumulated_seconds,
      'resume must preserve the frozen total, not reset to 0',
    ).toBe(frozen);

    // Emit the real before/after numbers for the report.
    console.log('[BREAK-TEST]', JSON.stringify({
      worker: WORKER,
      unit: REAL_UNIT_LABEL,
      frozen_on_break_s: frozen,
      frozen_after_wait_s: paused2?.accumulated_seconds,
      after_resume_s: afterResume?.accumulated_seconds,
      resume_status: afterResume?.status,
    }));
  });
});
