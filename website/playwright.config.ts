import { defineConfig, devices } from '@playwright/test';

// E2E harness for the deployed InlineIQ web app (crew / supervisor UI).
// By default it runs against the live site; override with TEST_BASE_URL to point
// at a preview deployment or a local `npm run dev` instance.
//
// PREVIEW PROTECTION BYPASS: preview deployments are behind Vercel Deployment
// Protection. Instead of minting a per-run _vercel_share link, set the project's
// "Protection Bypass for Automation" secret as VERCEL_AUTOMATION_BYPASS_SECRET
// (in .env.e2e). We send it as a header on EVERY request below, so every spec is
// bypassed automatically — no per-spec goto('/?_vercel_share=…') needed.
//
// SAFETY: specs assert they are pointed at the TEST tenant before mutating data
// (see tests/sort-list.spec.ts). Never run these against a production tenant.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests',
  // One worker — these specs mutate shared backend state on the test tenant, so
  // parallel runs would race each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'https://inlineiq.app',
    viewport: { width: 1366, height: 900 }, // desktop → supervisor sidebar nav is visible
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // Vercel automation bypass header on every request (set-cookie too, so any
    // client-side navigation that misses the header still rides the cookie). Empty
    // when the secret is unset (e.g. local dev / inlineiq.app, which need no bypass).
    extraHTTPHeaders: bypass
      ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
