# E2E test harness (Playwright)

End-to-end browser tests for the InlineIQ crew/supervisor web UI. **This is the
standard verification step for any future crew/supervisor UI change** — run it
before merging UI work, not just once.

Tests drive a real browser against the **deployed** site (`https://inlineiq.app`
by default) and exercise the same Supabase backend the app uses.

## ⚠️ Safety — test tenant only

These specs mutate backend state, so they are locked to the **test tenant**
`b69e7a5e-ea31-4b2d-a413-b32cb8f0289f` ("Pegasus", owner `user@inlineiq.app`).
`sort-list.spec.ts` refuses to run if `TEST_TENANT_ID` is anything else. **Never
point this at a real customer tenant.**

## One-time setup (already done in this Codespace)

```bash
cd website
npm install -D @playwright/test
npx playwright install chromium
```

## Running the suite

### 1. Seed a test entry

Each Sort List entry is consumed by the test (it gets assigned away), so seed a
fresh one first. The seed script only writes to the test tenant.

```bash
cd website
node scripts/seed-sort-list-entry.mjs
```

It prints the two values to export:

```
export TEST_CABINET_UNIT_ID='…'
export TEST_UNIT_LABEL='E2E-SORT-TEST …'
```

Remove old test units any time with `node scripts/seed-sort-list-entry.mjs --clean`.

### 2. Provide credentials + run

```bash
cd website
export TEST_CABINET_UNIT_ID='…'        # from the seed output
export TEST_UNIT_LABEL='E2E-SORT-TEST …'  # from the seed output
export TEST_LOGIN_PASSWORD='…'         # password for user@inlineiq.app
export TEST_SUPERVISOR_PIN='…'         # supervisor PIN for the test tenant

npx playwright test                    # run everything
npx playwright test sort-list          # just this spec
npx playwright test --headed           # watch it run
```

Keep secrets out of git — export them in your shell, or put them in an untracked
`website/.env.e2e` and `set -a; source .env.e2e; set +a` before running.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TEST_LOGIN_PASSWORD` | yes | — | Login password for the tenant owner |
| `TEST_SUPERVISOR_PIN` | yes | — | Supervisor PIN for the test tenant |
| `TEST_CABINET_UNIT_ID` | yes | — | Seeded unit id (from seed script) |
| `TEST_UNIT_LABEL` | yes | — | Seeded unit label (from seed script) |
| `TEST_LOGIN_EMAIL` | no | `user@inlineiq.app` | Tenant owner login |
| `TEST_TENANT_ID` | no | test tenant | Safety guard — must equal the test tenant |
| `TEST_BASE_URL` | no | `https://inlineiq.app` | Target site (e.g. a preview URL or `http://localhost:3000`) |

## Results & debugging

- Failures capture a **screenshot, video, and trace** under `website/test-results/`.
- An HTML report is written to `website/playwright-report/`; open it with
  `npx playwright show-report`.
- View a trace interactively: `npx playwright show-trace test-results/<…>/trace.zip`.

## Adding tests

Drop new `*.spec.ts` files in `website/tests/`. Reuse the env-driven, test-tenant
guard pattern from `sort-list.spec.ts` for anything that writes data. Prefer
stable locators: a `data-testid` / `data-cabinet-unit-id` hook on the element
(falling back to visible text) so the test survives styling changes.
```
