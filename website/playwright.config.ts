import { defineConfig, devices } from '@playwright/test';

// E2E harness for the deployed InlineIQ web app (crew / supervisor UI).
// By default it runs against the live site; override with TEST_BASE_URL to point
// at a preview deployment or a local `npm run dev` instance.
//
// SAFETY: specs assert they are pointed at the TEST tenant before mutating data
// (see tests/sort-list.spec.ts). Never run these against a production tenant.
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
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
