# Chore: ci: run the website Playwright e2e suite on GitHub Actions

## Metadata

issue_number: `249`
adw_id: `32f1e217`
issue_json: `{"number":249,"title":"ci: run the website Playwright e2e suite on GitHub Actions", ...}` (full body in GitHub issue #249)

## Chore Description

Run the website's Playwright `e2e/` suite on GitHub Actions for every pull request into `develop`,
against a Supabase stack started on the runner, with every external service mocked or given a dummy
key. Today the suite runs only by hand and as step 7 of the ADW test phase, and
`apps/website/AGENTS.md` says it is "deliberately not in CI" because CI has no dev server, no local
Supabase, no `.env.development` and no mock flags. The new `E2E` workflow supplies all four inside
the job, and the docs that state the old rule are updated.

Part 2 (owner decision): Sentry must only send from the live site. Server, edge and client Sentry
`init` get `enabled` from one small pure helper that returns true only for the Vercel `production`
environment, with a unit test, and a dedicated Playwright spec proves an e2e run sends nothing to
Sentry.

Facts checked on this worktree (branch from `develop` at `fc4e61c`):

- `git ls-files apps/website/e2e/lockin-waitlist.integration.spec.ts` prints nothing: PR #247 has
  merged and the spec is gone. So the workflow has **no** `--grep-invert` and makes **no**
  reference to the waitlist or #247.
- #248 has merged: `apps/website/e2e/booking-webhook-confirmation.integration.spec.ts` exists and
  reads `process.env.STRIPE_WEBHOOK_SECRET` in the Playwright process (line ~47) and throws if it is
  unset. Setting it at job level gives the dev server and the Playwright process the same value.
- Current specs (10 files): `blog-booking-flow`, `booking-calendar-close-scroll`,
  `booking-confirmation`, `booking-flow`, `booking-og-metadata`, `booking-split-guest-contact`,
  `booking-webhook-confirmation`, `lock-in-flow`, `shop`, `site-smoke` (all
  `*.integration.spec.ts`), plus `e2e/support/journeys.ts`.
- `apps/website/next.config.ts` sets `tunnelRoute: "/monitoring"` in `withSentryConfig`. Browser
  Sentry traffic therefore goes to the **same origin** at `/monitoring?...`, which the Next server
  forwards to `*.ingest.de.sentry.io`. A Playwright check for "no request to
  `*.ingest.de.sentry.io`" alone would pass even with client Sentry enabled. The new spec must also
  assert no request whose path starts with `/monitoring`.
- No website doc currently describes Sentry beyond a line in `README.md` ("Error tracking via
  Sentry"), `ENGINEERING.md` line 32 (`lib/ ... sentry`) and line 117 (`SENTRY_AUTH_TOKEN`).
  `app_docs/analytics.md` is PostHog only. The Sentry rule goes into `ENGINEERING.md` (a new
  `## Error tracking (Sentry)` section) and, as a behavioural rule, into `apps/website/AGENTS.md`.
- `apps/website/.gitignore` ignores `test-results/` but not `playwright-report/`. The CI run writes
  the HTML report only on the runner; local and ADW runs use the default reporter, so nothing new
  appears in a local tree. Leave `.gitignore` unchanged (out of scope).

## Relevant Files

Use these files to resolve the chore:

- `.github/workflows/ci.yml` - Reference for checkout / corepack / setup-node / install / chromium
  install step shapes. Must stay unchanged.
- `.github/workflows/migrations.yml` - Reference for `supabase/setup-cli@v1` with `version: 2.116.0`
  and `supabase start` from the repo root, and for the header-comment style (one concern per
  workflow). Must stay unchanged.
- `supabase/config.toml` - Root Supabase project (`project_id = "issebya-homes-ai-system"`, API
  54331, DB 54332) that `supabase start` on the runner uses. Read only.
- `apps/website/playwright.config.ts` - `workers: 1`, `webServer` (`yarn dev:next`, `timeout: 60000`,
  `reuseExistingServer: !process.env.CI`, three `E2E_MOCK_*` in `webServer.env`), chromium-only
  under `CI`. Changed only if the CI log shows the cold `next dev` start over 60s.
- `apps/website/src/instrumentation.ts` - The three in-process mocks and the Sentry config imports.
  Read only; mock names and behaviour unchanged.
- `apps/website/sentry.server.config.ts` - Add `enabled` from the helper (server reads
  `process.env.VERCEL_ENV`).
- `apps/website/sentry.edge.config.ts` - Same, edge runtime.
- `apps/website/src/instrumentation-client.ts` - Add `enabled` from the helper (client reads
  `process.env.NEXT_PUBLIC_VERCEL_ENV`, a literal read so Next inlines it, as line 51 already does
  for PostHog).
- `apps/website/src/lib/analytics.ts` and `apps/website/src/lib/__tests__/analytics.unit.test.ts` -
  The existing pattern for a pure, node-testable start-up decision and its unit test; model the
  Sentry helper and test on them.
- `apps/website/e2e/site-smoke.integration.spec.ts` - Target of the red probe (first test, expected
  redirect `/booking/room1`). Must be unchanged in the final diff.
- `apps/website/e2e/booking-og-metadata.integration.spec.ts` (or any short existing spec) - Model for
  the new Sentry spec's imports and style.
- `apps/website/AGENTS.md` - "Which test layers gate, and which don't": replace the "deliberately
  not in CI" bullet; add the Sentry production-only rule.
- `apps/website/ENGINEERING.md` - Line 98 (`manual / ADW only, not in CI`), line 92 (says
  `playwright.config.ts` "spins up `yarn dev`", now `yarn dev:next`; fix only if touching that
  line anyway), plus a new `## Error tracking (Sentry)` section.
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md` - How to Use step 2 and the
  "Why the `e2e/` layer stays out of CI" note.
- `apps/website/app_docs/feature-0a3bfba6-guest-contact-split-row-upsert.md:54`,
  `feature-3b203d9a-wishlist-button-unsubscribe.md:64`, `feature-6db7ada5-shop-product-grid.md:68`,
  `feature-78e55892-booking-close-scroll-target.md:45`,
  `feature-9190fc91-stretched-link-product-card.md:48`,
  `feature-972c79dc-shop-wishlist-email-optin.md:121`,
  `feature-a93e052d-blog-widget-clear-float.md:46`, `feature-bf15ab13-forest-bathing-blog-post.md:70`,
  `feature-f72316fa-booking-og-metadata.md:96` - Each says an e2e spec is "not in CI" / "not run in
  CI" / "does not gate CI" / "not CI)". Change only that phrase.
- `.adw/project.md` - `## Tests`: one sentence that CI also runs the suite
  (`.github/workflows/e2e.yml`). No heading renamed or reordered.
- `docs/conditional-docs.md` - Add a condition to the `apps/website/ENGINEERING.md` entry for Sentry,
  and to the `feature-cc081a8b` entry for the e2e workflow (the document phase adds the new feature
  doc's entry).
- `apps/website/app_docs/testing/e2e_example.md` - Read before adding the Playwright spec
  (conditional-docs: "When adding a Playwright spec under `apps/website/e2e/`").
- `apps/website/app_docs/analytics.md` - Read for the `NEXT_PUBLIC_VERCEL_ENV === "production"` gate
  rationale (`NODE_ENV` is not the gate); the Sentry helper follows the same rule.
- `knip.json` - Already lists `src/**/*.unit.test.ts` and `e2e/**/*.ts` as website entries, so the
  new helper, test and spec need no knip change.
- `turbo.json` - No change: `VERCEL_ENV` is read at runtime on the server, and `NEXT_PUBLIC_*` vars
  are inlined by Next and picked up by turbo's framework inference.

### New Files

- `.github/workflows/e2e.yml` - The `E2E` workflow, job `website-e2e`.
- `apps/website/src/lib/sentry-enabled.ts` - Pure helper `isSentryEnabled(vercelEnv: string |
undefined): boolean`, returning `vercelEnv === "production"`.
- `apps/website/src/lib/__tests__/sentry-enabled.unit.test.ts` - Unit test for the helper.
- `apps/website/e2e/sentry-disabled.integration.spec.ts` - Asserts an e2e page load sends nothing to
  Sentry (neither `*.sentry.io` nor the `/monitoring` tunnel).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

Protected (from `.adw/project.md`): this run never runs `supabase start`, `supabase stop`,
`supabase db reset`, a migration or a seed locally. `supabase start` appears only inside
`e2e.yml`, on a GitHub runner. Never `npm`/`npx`. Never `--no-verify`.

### 1. Sentry helper and its unit test

- Create `apps/website/src/lib/sentry-enabled.ts`: a header comment (two or three lines, matching
  `analytics.ts`'s style) saying Sentry sends only from the production Vercel deploy, that `NODE_ENV`
  is not the gate because it is `"production"` on previews too, and that callers pass the variable
  in so this stays testable in node. Export
  `export function isSentryEnabled(vercelEnv: string | undefined): boolean { return vercelEnv === "production"; }`.
  No `@sentry/nextjs` import.
- Create `apps/website/src/lib/__tests__/sentry-enabled.unit.test.ts` with `describe`/`test` from
  `vitest`, importing from `../sentry-enabled`: `"production"` is true; `"preview"`,
  `"development"`, `undefined` and `""` are false (a `test.each` is fine).
- Run `yarn turbo run test --filter=./apps/website` and see it pass.
- Negative check (do not commit): change the helper to also return true for `"preview"`, re-run the
  unit project (`yarn workspace website vitest run --project unit src/lib/__tests__/sentry-enabled.unit.test.ts`),
  see the `"preview"` case fail, revert, re-run green. Record both outcomes for the PR.

### 2. Wire `enabled` into the three Sentry configs

- `apps/website/sentry.server.config.ts`: import `isSentryEnabled` from `@/lib/sentry-enabled` and
  add `enabled: isSentryEnabled(process.env.VERCEL_ENV),` with a one-line comment
  (`// Production deploy only: local, e2e and preview runs send nothing.`). DSN and every other
  option unchanged.
- `apps/website/sentry.edge.config.ts`: same import and `enabled: isSentryEnabled(process.env.VERCEL_ENV),`.
- `apps/website/src/instrumentation-client.ts`: same import and
  `enabled: isSentryEnabled(process.env.NEXT_PUBLIC_VERCEL_ENV),` (literal `process.env.` read so
  Next inlines it). Nothing else in the file changes; `onRouterTransitionStart` and the PostHog
  block stay as they are.
- `yarn turbo run typecheck --filter=./apps/website` passes.

### 3. Playwright spec: no Sentry traffic during e2e

- Read `apps/website/app_docs/testing/e2e_example.md` and one existing short spec for style.
- Create `apps/website/e2e/sentry-disabled.integration.spec.ts`, touching no database:
  - A short header comment: Sentry is production-only (`src/lib/sentry-enabled.ts`); the client
    reports through the `/monitoring` tunnel (`tunnelRoute` in `next.config.ts`), so the check covers
    both that path and `*.sentry.io`.
  - One test: register `page.on("request", ...)` collecting URLs where
    `new URL(url).hostname.endsWith(".sentry.io")` or (`origin` equals the test's `baseURL` origin and
    `pathname.startsWith("/monitoring")`). `page.goto("/booking/room1")`, wait for the booking engine
    (`page.getByLabel("Book selected dates")` visible), then trigger a client-side error that an
    enabled Sentry would definitely report, e.g.
    `await page.evaluate(() => setTimeout(() => { throw new Error("e2e sentry probe"); }))`, then
    `await page.waitForLoadState("networkidle")` (or a fixed short `page.waitForTimeout(2000)` with a
    comment why: the SDK batches envelopes). Assert `expect(sentryRequests).toEqual([])`.
- Prove the spec can fail (do not commit): with the local dev server for this run, temporarily make
  `isSentryEnabled` return `true`, run just this spec on chromium
  (`PORT=<run port> yarn workspace website test:integration --project=chromium e2e/sentry-disabled.integration.spec.ts`,
  with the `prepare_app` server up and the port overrides from `.adw/project.md`), see it fail
  listing a `/monitoring` request, revert, see it pass. If the forced-true run shows no request at
  all, the probe error is not reaching Sentry: strengthen the trigger before trusting the spec.
  Note: with `enabled: true` locally this sends one probe event to the real Sentry project, which is
  today's behaviour for every local run; acceptable once, do not repeat.

### 4. Add `.github/workflows/e2e.yml`

Write the file below (no em dashes anywhere, comments included). No `--grep-invert`: the waitlist
spec is gone.

```yaml
name: E2E

# Separate from ci.yml on purpose, same convention as migrations.yml and
# eval-golden.yml: one concern per workflow.
#
# Runs the website's Playwright e2e suite (chromium) on every PR into develop,
# against a Supabase stack started on this runner from supabase/migrations/.
# Every external service is mocked or keyed with a dummy: the three E2E_MOCK_*
# flags are on (src/instrumentation.ts), Stripe and Resend keys are fake, iCal
# feeds are the app's own /dev-ical files, PostHog and Sentry stay off because
# NEXT_PUBLIC_VERCEL_ENV / VERCEL_ENV are unset. No secrets are read, and the
# job talks only to the stack it started.
#
# No paths: filter, on purpose. A filtered workflow never reports a check,
# which is why migrations.yml gave up its own.
#
# The Supabase CLI is pinned to the same version as migrations.yml. Bump both
# together, on purpose.

on:
  pull_request:
    branches: [develop]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  website-e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    env:
      # Dummies only. Unmocked Stripe or Resend calls fail on auth instead of
      # reaching a real account. STRIPE_WEBHOOK_SECRET is job-level so the dev
      # server and the Playwright process sign and verify with the same value.
      STRIPE_SECRET_KEY: sk_test_e2e_ci_dummy
      STRIPE_WEBHOOK_SECRET: whsec_e2e_ci_dummy
      RESEND_API_KEY: re_e2e_ci_dummy
      RESEND_FROM_EMAIL: e2e@example.com
      ADMIN_NOTIFICATION_EMAIL: e2e-admin@example.com
      # A leading / resolves against PORT (src/lib/ical-feed-url.ts) and is
      # served from apps/website/public/dev-ical/.
      ROOM1_ICAL_AIRBNB: /dev-ical/room1-airbnb.ics
      ROOM1_ICAL_VRBO: /dev-ical/room1-vrbo.ics
      ROOM1_ICAL_BOOKING: /dev-ical/room1-booking.ics
      ROOM2_ICAL_AIRBNB: /dev-ical/room2-airbnb.ics
      ROOM2_ICAL_VRBO: /dev-ical/room2-vrbo.ics
      ROOM2_ICAL_BOOKING: /dev-ical/room2-booking.ics
      E2E_MOCK_STRIPE: "true"
      E2E_MOCK_ICAL_FAILURE: "true"
      E2E_MOCK_RESEND: "true"
      PORT: "3000"
      PLAYWRIGHT_HTML_OPEN: never
    steps:
      - uses: actions/checkout@v4

      - name: Enable Corepack
        run: corepack enable

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "yarn"

      - name: Install dependencies
        run: yarn install --immutable

      - name: Set up Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: 2.116.0

      # Root project (supabase/config.toml). Applies every migration to a
      # fresh database; no db reset or separate migration step needed.
      - name: Start Supabase
        run: supabase start

      - name: Export Supabase env
        run: |
          eval "$(supabase status -o env)"
          {
            echo "SUPABASE_URL=$API_URL"
            echo "SUPABASE_ANON_KEY=$ANON_KEY"
            echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
          } >> "$GITHUB_ENV"

      - name: Install Playwright browser (chromium)
        run: yarn workspace website playwright install --with-deps chromium

      # CI=true (set by GitHub) makes playwright.config.ts start its own
      # next dev server and run the chromium project only.
      - name: Run e2e suite
        run: yarn workspace website test:integration --project=chromium --reporter=list,html --trace=retain-on-failure

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            apps/website/playwright-report/
            apps/website/test-results/
          retention-days: 14
          if-no-files-found: ignore

      - name: Stop Supabase
        if: always()
        run: supabase stop
```

- Do not add `-x` / `--exclude` to `supabase start` (unmeasured; the seller form uses Storage).
- If `supabase status -o env` keys differ on the runner (check the step log on the first run), fix
  the mapping, never hardcode a key.
- `actionlint .github/workflows/e2e.yml` prints nothing; `grep -n "secrets\." .github/workflows/e2e.yml`
  prints nothing; `grep -n "—" .github/workflows/e2e.yml` prints nothing.

### 5. Docs

- `apps/website/AGENTS.md`, "Which test layers gate, and which don't": replace the "deliberately not
  in CI" bullet with: the `E2E` workflow (`.github/workflows/e2e.yml`) runs the chromium `e2e/` suite
  on every PR into `develop`, against a Supabase stack started on the runner, with the three
  `E2E_MOCK_*` mocks on and dummy Stripe/Resend keys; a spec added under `e2e/` now gates PRs into
  `develop` (not pushes, and not the lefthook hook); it is still step 7 of the ADW test phase; if a
  spec fails only in CI, fix the job's environment, never the spec or with retries; and never put a
  real key into that workflow. Add a bullet (or short `## Sentry` section) with the rule: Sentry is
  production-only via `src/lib/sentry-enabled.ts`; never enable it from `NODE_ENV`; the client goes
  through the `/monitoring` tunnel.
- `apps/website/ENGINEERING.md`: line 98 becomes
  `yarn test:integration # Playwright E2E, manual / ADW, and the E2E workflow on PRs into develop`;
  line 88-90 prose if it says "manually and via the ADW test phase" only, add CI; line 92 may say
  `yarn dev:next` instead of `yarn dev`. Add a `## Error tracking (Sentry)` section before
  `## Environment variables`: three configs (server, edge, client), all gated by `isSentryEnabled`
  (`VERCEL_ENV` on server/edge, `NEXT_PUBLIC_VERCEL_ENV` on the client), so local, e2e (local, ADW,
  CI) and preview runs send nothing; DSN hardcoded and public; client traffic tunnels through
  `/monitoring`; errors in tests stay visible in the Playwright report artifact and the job log.
  End it with a short `### Rules` list (production-only; never gate on `NODE_ENV`; keep the
  helper the single decision point; the `sentry-disabled` spec must watch `/monitoring`).
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md`: How to Use step 2 becomes
  "... A spec added under `e2e/` gates PRs into `develop` through the `E2E` workflow, not the push
  hook."; step 4 mentions CI runs it too; rename the "Why the `e2e/` layer stays out of CI" note to
  a past-tense note that it stayed out until issue 249 added `.github/workflows/e2e.yml`, which
  provides the server, a runner-local Supabase and the mocks.
- The nine `app_docs` lines listed in Relevant Files: change only the CI phrase, e.g. "not in CI" to
  "E2E workflow on PRs into develop", "ADW test phase only, not CI" to "ADW test phase and the E2E
  workflow", "local only, does not gate CI" to "gates PRs into develop via the E2E workflow". Re-run
  `git grep -n -i "not in CI\|not run in CI\|does not gate CI\|not CI)" apps/website/app_docs`; it
  must print nothing except the cc081a8b note if kept as history (prefer rewording it too).
- `.adw/project.md`, `## Tests`, after the E2E paragraph: one sentence, e.g. "CI also runs this suite,
  chromium only, on every PR into `develop` (`.github/workflows/e2e.yml`), with its own runner-local
  Supabase; that has no bearing on how the test phase runs it." No heading renamed or reordered.
- `docs/conditional-docs.md`: add to the `apps/website/ENGINEERING.md` entry "When touching Sentry
  init, `sentry-enabled.ts`, or the `/monitoring` tunnel"; add to the `feature-cc081a8b` entry "When
  changing `.github/workflows/e2e.yml` or what the e2e suite needs in CI".
- `yarn prettier --write .` then `yarn prettier --check .`.

### 6. Commit and open the PR

- Commits: `ci: run the website e2e suite on GitHub Actions` (workflow, `.adw/project.md`,
  `docs/`), `feat(website): send Sentry events from production only` (helper, test, configs,
  spec), `docs(website): e2e now gates PRs into develop` (website docs). No scope on root-config
  commits. No `Co-Authored-By`. Do not add or strip `Deploy-Preview: yes` by hand.
- Push and open the PR into `develop` the way the ADW pipeline does (its own phase). Then
  `gh pr checks <pr> --watch`.

### 7. Verify the green CI run

- In the `E2E / website-e2e` log: `Start Supabase` finishes; Playwright's summary shows `N passed`
  with `N` equal to the count from `yarn workspace website playwright test --list --project=chromium`
  on the PR branch (run locally with `CI=1` unset is fine for `--list`; it does not start a server).
  A green job with 0 tests fails this check.
- If any spec fails only in CI, fix the job environment (missing env var, Supabase key mapping),
  never the spec, never `--retries`, `test.skip`, `|| true` or `continue-on-error`.
- Read the `Run e2e suite` log for the `next dev` ready time. Only if the cold start exceeds 60s and
  Playwright times out waiting for the server, raise `webServer.timeout` in
  `apps/website/playwright.config.ts` (e.g. `120000`, with a comment) and quote the measured time.
- Record step durations for the PR and feature doc: install, `supabase start`, chromium install
  (setup), and the suite.

### 8. Red probe (must leave no trace)

- From the PR branch: `git switch -c probe/e2e-ci-red-32f1e217`, change the first assertion in
  `apps/website/e2e/site-smoke.integration.spec.ts` (`/booking/room1` redirect for `/`) to
  `/booking/room9`, commit, push, open a **draft** PR into `develop`.
- `gh run watch <run id> --exit-status` exits non-zero; the failing test named in the log is
  `/ and /booking redirect to /booking/room1`.
- `gh api repos/SBub/issebya-homes-ai-system/actions/runs/<run id>/artifacts --jq '.artifacts[].name'`
  lists `playwright-report`.
- `gh pr close <n> --delete-branch`; `git switch` back to the PR branch; delete the local probe
  branch. `git ls-remote origin 'refs/heads/probe/*'` prints nothing;
  `git diff origin/develop...HEAD -- apps/website/e2e` shows only the new
  `sentry-disabled.integration.spec.ts` (no change to any existing spec).
- Quote the failing run URL and failure line in the PR.

### 9. Run the Validation Commands

## Test Coverage

- Unit (`*.unit.test.ts`): `apps/website/src/lib/__tests__/sentry-enabled.unit.test.ts`. Catches
  Sentry being enabled for anything other than Vercel production (preview, development, unset);
  nothing tests that decision today because there is none.
- Playwright (`apps/website/e2e/*.spec.ts`): `apps/website/e2e/sentry-disabled.integration.spec.ts`.
  Catches a client Sentry still sending from a non-production run, including through the
  `/monitoring` tunnel, which a hostname-only check would miss. It runs in the ADW test phase and,
  after this change, in the `E2E` workflow.
- The workflow itself has no automated test layer in this repo: it is verified by the PR's own
  green `E2E / website-e2e` check (N passed, N matching `--list`) and the red probe in task 8, which
  proves a failing spec turns the job red and uploads the report.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `actionlint .github/workflows/e2e.yml` - workflow syntax and expression check; must print nothing.
- `grep -n "secrets\." .github/workflows/e2e.yml` - must print nothing (no production credentials).
- `grep -rn "—" .github/workflows/e2e.yml apps/website/src/lib/sentry-enabled.ts apps/website/e2e/sentry-disabled.integration.spec.ts` - must print nothing (no em dashes).
- `git diff origin/develop --stat -- .github/workflows/ci.yml .github/workflows/migrations.yml` - must print nothing (both unchanged).
- `git ls-files apps/website/e2e/lockin-waitlist.integration.spec.ts` - prints nothing, confirming no exclusion is needed.
- `git grep -n -i "not in CI\|not run in CI\|does not gate CI\|not CI)" apps/website/app_docs apps/website/AGENTS.md apps/website/ENGINEERING.md` - no stale "not in CI" claims remain.
- `yarn turbo run typecheck --filter=./apps/website` - the three Sentry configs, helper and spec typecheck.
- `yarn turbo run lint --filter=./apps/website` - lint, including `no-secrets` on the touched config files.
- `yarn prettier --check .` - formatting of YAML, TS and Markdown.
- `yarn knip` - helper, test and spec are reachable; no unused export.
- `yarn turbo run test --filter=./apps/website` - unit (incl. `sentry-enabled`) and chromium browser projects.
- `yarn turbo run build --filter=./apps/website` - Sentry configs still build with `enabled`.
- `yarn workspace website playwright test --list --project=chromium` - the count `N` the CI run must report as passed.
- `PORT=<run port> yarn workspace website test:integration --project=chromium` - the ADW test phase's own e2e run (with the `prepare_app` server up, never `CI=1`); the full suite including the new spec passes locally.
- `gh pr checks <pr> --watch` - the PR's `E2E / website-e2e` check is green with `N passed`.

## Notes

- Trade-off on CI time (for the feature doc): every PR into `develop` gets a second job, parallel to
  `check`, so wall-clock cost is the slower of the two. Known parts: `supabase start` about 2 min,
  chromium install about 30s, `yarn install`; the suite (one worker, `next dev` compiling routes on
  first hit) is measured by this change. The repo is public, so standard-runner minutes are free.
  No `paths:` filter, because a filtered workflow never reports a check. Record the measured split
  (setup vs suite) and the `next dev` ready time in the feature doc and PR.
- Sentry: until this change every CI e2e run would have reported to the real Sentry project; with
  `enabled` gated on production, CI, local, ADW and preview runs send nothing. `VERCEL_ENV` is read
  at runtime on server and edge (a Vercel system variable, present at runtime), so no `turbo.json`
  change is needed. Errors in tests remain visible via the Playwright report artifact and the log.
- The new `sentry-disabled` spec is the only new spec; no existing spec is edited (the issue's "no
  edits to specs" constraint is about weakening the suite; the issue explicitly allows "a dedicated
  tiny spec" for the Sentry check).
- Out of scope: required-check settings, `setup-cli@v3`, a CLI bump, `ci.yml` / `migrations.yml`
  edits, a production build for e2e, caching browsers or Docker images, the other apps,
  `.gitignore` for `playwright-report/`.
- No visual review needed: no user-visible flow changes (CI config, Sentry init flag, docs).
