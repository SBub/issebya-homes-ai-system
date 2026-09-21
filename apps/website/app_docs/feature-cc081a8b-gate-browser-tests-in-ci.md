# Browser tests in the automated gate

**ADW ID:** cc081a8b
**Date:** 2026-09-21
**Specification:** `specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md`

## Overview

The 7 `*.browser.test.tsx` files in `apps/website` (53 assertions) sat outside
every automated gate: `test` was `vitest run --project unit`, and that is the
only test command CI and the lefthook `pre-push` hook run. The browser layer was
reachable only through `yarn workspace website test:browser`, which nothing
automated invoked, so component contracts could silently rot. This change puts
the browser project into the gate as a chromium-only run, keeps the
three-browser sweep as an explicit opt-in, and writes down why the Playwright
`e2e/` layer deliberately stays out.

## What Was Built

- `apps/website`'s `test` script now runs both Vitest projects (`unit` and
  `browser`), so turbo's `test` task, CI and the pre-push hook all cover the
  browser layer.
- A `VITEST_ALL_BROWSERS` switch in `vitest.config.ts` that selects between the
  gated chromium-only instance list and the full chromium/firefox/webkit sweep.
- `test:browser` re-pointed at the full sweep by setting that variable, so the
  existing command keeps its existing meaning.
- A CI step that installs the chromium Playwright binary before the test step.
- A complete `optimizeDeps.include` list for the browser project, so the gated
  run survives a cold Vite cache.
- The gate boundary recorded in `apps/website/AGENTS.md` and
  `apps/website/ENGINEERING.md`, including the deliberate `e2e/` exemption.

## Technical Implementation

### Files Modified

- `apps/website/package.json`: `test` changed from `vitest run --project unit`
  to `vitest run`; `test:browser` changed to
  `VITEST_ALL_BROWSERS=1 vitest --project browser`. `test:unit` and
  `test:integration` untouched, and no other workspace's `test` script changed.
- `apps/website/vitest.config.ts`: added a `browserInstances` constant keyed on
  `VITEST_ALL_BROWSERS` and used it for `browser.instances`; extended the
  browser project's `optimizeDeps.include` from 8 entries to 15.
- `.github/workflows/ci.yml`: new `Install Playwright browser (chromium)` step,
  `yarn workspace website playwright install --with-deps chromium`, placed
  between the knip step and the `Tests` step.
- `apps/website/AGENTS.md`: new section "Which test layers gate, and which
  don't".
- `apps/website/ENGINEERING.md`: `## Testing` command list rewritten to name the
  gating command, plus a line under the layer table saying which rows gate.
- `docs/conditional-docs.md`: a condition added to the
  `apps/website/ENGINEERING.md` entry for "which test layers run in CI and on
  push".

### Key Changes

- **The gate is chromium everywhere, not chromium-when-CI.** The issue asked for
  `process.env.CI` keying with all three browsers locally. Webkit cannot launch
  on macOS 14 arm64 at all (Playwright ships a frozen build there and the
  connection times out after ~60s), so the literal form would make every local
  `git push` spend a minute and then hard-fail. Keying on `VITEST_ALL_BROWSERS`
  instead keeps the gate identical in both places and makes the sweep an
  explicit opt-in. Reverting to the `CI`-keyed form is a one-line swap in
  `vitest.config.ts` plus dropping the env prefix from `test:browser`.
- **`optimizeDeps.include` had to grow.** Gating the browser project means it
  runs on a cold `.vite` cache in every CI job and on a developer's first push
  after `yarn install`. With only the original 8 entries, Vite discovered
  `vitest-browser-react`, `next/link`, `next/cache`, `next/headers`, `stripe`,
  `@supabase/supabase-js` and `ical.js` mid-run, re-optimized, reloaded the page
  and destroyed the Vitest runner (`Vitest failed to find the runner`). All 7
  are now pre-bundled. A warm cache masks this completely, which is why the
  first validation pass reported green and CI run 35610951589 did not.
- **No browser test was modified.** All 53 assertions passed unchanged on
  chromium under CI's timezone, so nothing needed an environment-dependent fix.
- **No turbo config change.** The `test` task has `outputs: []` and no `env`
  list, and `VITEST_ALL_BROWSERS` is only ever set by the direct
  `test:browser` invocation, so it cannot perturb turbo's task hash. `knip.json`
  already listed `src/**/*.browser.test.tsx` as a website entry point.

## How to Use

1. `yarn turbo run test --filter=./apps/website` (or `yarn test` inside the
   workspace) now runs unit plus chromium browser tests. This is exactly what CI
   and the pre-push hook run.
2. To add a test that gates, write a `*.unit.test.ts` or a
   `*.browser.test.tsx`. A spec added under `e2e/` will not re-run in CI.
3. For the cross-browser sweep, run `yarn workspace website test:browser`. It
   sets `VITEST_ALL_BROWSERS=1` and covers chromium, firefox and webkit in watch
   mode. Expect webkit to fail to launch on macOS 14 arm64.
4. For the Playwright E2E layer, run `yarn workspace website test:integration`
   manually, with the dev server, local Supabase and `.env.development` in
   place.

## Configuration

- `VITEST_ALL_BROWSERS=1` selects the three-browser instance list in
  `apps/website/vitest.config.ts`. Anything else (including unset) gives the
  gated chromium-only run. It is set by the `test:browser` script and by nothing
  else.
- CI needs the chromium binary; `yarn install` does not fetch browser binaries,
  hence the explicit install step. Keep that command inside the website
  workspace so it resolves the `playwright` version pinned there (`^1.58.2`) and
  the binary always matches the client.
- No `.env` variable is involved in the gated run.

## Testing

- The delta is the signal: `yarn turbo run test --filter=./apps/website --force`
  reported 205 tests in 13 files before, and 258 tests in 20 files after, with
  `browser (chromium)` listed among the executing projects.
- **Validate cold, never warm.** A warm `.vite` cache hides mid-run dependency
  discovery entirely:
  `rm -rf apps/website/node_modules/.vite && yarn turbo run test --filter=./apps/website --force`.
- The negative test: breaking an assertion in
  `src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx` must turn the `Tests`
  step red and name the browser project. That is what proves the project is
  genuinely wired in rather than silently matching zero files.
- `vitest.config.ts` is in `tsconfig.json`'s `exclude` list, so a typo in the
  instances array surfaces as a runtime failure at test start, not as a `tsc`
  error. Run the tests after editing it; `typecheck` will not catch it.

## Notes

- **Wall time** (warm cache, macOS 14 arm64): before 205 tests / 13 files /
  ~4.3s; after 258 tests / 20 files / ~8.1s reported by Vitest, ~9s wall for the
  turbo task. Roughly +4s per `git push`. The three-browser variant would have
  been ~60s and unrunnable on this platform.
- The manual sweep reports 106 passed (53 each on chromium and firefox) across
  21 files and exits 1 on the webkit connection timeout. That exit code is
  expected on macOS 14 arm64 and is not a regression.
- **Why the `e2e/` layer stays out of CI:** it needs a running dev server on the
  run's own port, the shared local Supabase, `.env.development`, and the
  `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` in-process mocks from
  `src/instrumentation.ts`. None of that exists in the CI image. It runs
  manually and as step 7 of the ADW test phase (`.claude/commands/test.md`).
- Caching the chromium download in CI was left out on purpose. The install is
  ~30s; an `actions/cache` keyed on the Playwright version is a reasonable
  follow-up if the CI budget tightens, at the cost of a cache-invalidation
  failure mode.
- This change spans two workspaces' worth of files: `apps/website` holds the
  majority, and the two repo-root files it touches are
  `.github/workflows/ci.yml` and `docs/conditional-docs.md`. Documented here
  because the behaviour being changed is the website's test gate.
