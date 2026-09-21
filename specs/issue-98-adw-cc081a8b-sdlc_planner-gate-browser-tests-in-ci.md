# Chore: Bring the website browser-test layer into the automated gate, and record the e2e exemption

## Metadata

issue_number: `98`
adw_id: `cc081a8b`
issue_json: `{"number":98,"title":"tech debt: Neither of this change's two new test artifacts runs in any automated gate. apps/website's `test`sc","body":"## Decision (supersedes \"pick one\" below; #82 was the same finding and is closed as a duplicate)\n\n- **Browser tests join the gate — option (a)**:`apps/website`'s `test`script becomes`vitest run`(both projects), so turbo's`test`task, CI's`yarn turbo run test`and the lefthook pre-push hook all run the 7`*.browser.test.tsx` files. In CI install only chromium (`yarn playwright install --with-deps chromium`) and restrict `browser.instances`in`apps/website/vitest.config.ts`to chromium when`CI` is set; locally all configured browsers stay as they are.\n- **Playwright e2e (`e2e/`) stays out of the gate — option (c) for that layer only**: it needs local Supabase, `.env.development`and the in-process Stripe mock. Record in`apps/website/AGENTS.md`that`yarn workspace website test:integration`is run manually and by the ADW test phase, not by CI, so the next person adding an e2e spec knows.\n- Constraints: existing browser tests must pass unchanged in CI (fix a test only if it is genuinely environment-dependent, and say which); the pre-push hook's wall time must stay acceptable — report before/after; no change to what`yarn test`means in other workspaces.\n- Verification: CI run on the PR shows the browser project executing (test count > 180 in the website`test`step); a deliberately broken assertion in`Breadcrumb.browser.test.tsx`fails CI (negative test — revert it before merge, prove the tree is clean);`yarn lint && yarn typecheck && yarn test && yarn knip`green.\n\nOriginal issue: #93\nBranch:`feat/issue-93-adw-437bcd03-blog-breadcrumb-trail`\n"}`

## Chore Description

The 7 `*.browser.test.tsx` files in `apps/website` are currently outside every
automated gate. `apps/website/package.json`'s `test` script is
`vitest run --project unit`, and that is the only test command CI runs
(`.github/workflows/ci.yml` → `yarn turbo run test`) and the only one lefthook's
`pre-push` hook runs. The browser project is reachable only through the separate
`yarn workspace website test:browser` command, which nothing automated invokes.
So 53 component assertions, including the breadcrumb accessibility contract from
issue #93, can silently rot.

This chore wires the browser layer into the gate and writes down the deliberate
exemption for the layer that stays out:

- `apps/website`'s `test` script becomes `vitest run` (both projects), so
  turbo's `test` task, CI and the pre-push hook all run unit + browser tests.
- The **gated** browser run is chromium-only. The three-browser sweep
  (chromium/firefox/webkit) stays available, unchanged, behind the existing
  `yarn workspace website test:browser` command.
- CI grows one step that installs the chromium Playwright build before tests.
- The Playwright `e2e/` suite stays out of CI on purpose (it needs local
  Supabase, `apps/website/.env.development` and the in-process Stripe/iCal mocks
  from `src/instrumentation.ts`). That decision gets recorded in
  `apps/website/AGENTS.md` so the next person adding a spec knows it runs
  manually and via the ADW test phase, not in CI.

### One deviation from the issue's decision, with the evidence

The issue says to restrict `browser.instances` to chromium _"when `CI` is set"_
and leave the local run sweeping all three browsers. Measured on this machine,
that literal form breaks `git push`:

- `yarn vitest run --project browser` (all three instances) takes **60s** and
  **fails**: `Failed to connect to the browser session ... [browser (webkit)]
within the timeout`. Running `yarn playwright install webkit` does not fix it
  — Playwright reports _"You are using a frozen webkit browser which does not
  receive updates anymore on mac14-arm64"_. Chromium alone: 53 passed in 4.4s.
  Firefox alone: 53 passed in 6.5s. Webkit alone: 60s, 0 tests, 1 unhandled
  error.
- With `test` = `vitest run` and three instances configured locally, every
  `git push` from this machine would spend 60s and then hard-fail on a browser
  that cannot run here at all — which also violates the issue's own constraint
  that "the pre-push hook's wall time must stay acceptable".

So the gate is chromium everywhere (CI and local), and the cross-browser sweep
becomes an explicit opt-in on the command that already exists for it. Nothing
about which browsers are _configured_ changes, and `yarn workspace website
test:browser` still runs all three. `Notes` records the one-line change back to
the literal `process.env.CI` form if that trade-off is preferred instead.

## Relevant Files

Use these files to resolve the chore:

- `apps/website/package.json` — holds the `test` script (`vitest run --project unit`)
  that turbo, CI and lefthook all resolve to, plus `test:unit` / `test:browser` /
  `test:integration`. This is the central change.
- `apps/website/vitest.config.ts` — defines the `unit` and `browser` projects and
  the `browser.instances` list (`chromium`, `firefox`, `webkit`). Needs the gated
  run narrowed to chromium. Note it is in `tsconfig.json`'s `exclude` list, so it
  is not typechecked; keep it simple.
- `.github/workflows/ci.yml` — the `Tests` step runs `yarn turbo run test`. Needs a
  Playwright chromium install step before it, or the browser project cannot launch.
- `lefthook.yml` — `pre-push` runs `yarn turbo run test`. No edit needed; it picks
  up the new `test` script automatically. Listed because its wall time is a
  constraint to measure and report.
- `apps/website/AGENTS.md` — behavioural rules for this workspace. Gets the record
  of which layers gate and why `e2e/` does not.
- `apps/website/ENGINEERING.md` — its `## Testing` table and command list describe
  the three layers; the command list is now out of date (`yarn test:browser` is no
  longer the only way browser tests run).
- `apps/website/playwright.config.ts` — precedent for the `process.env.CI ?
[chromium] : [chromium, firefox, webkit]` pattern; also documents why the e2e
  suite needs a real dev server, local Supabase and `.env.development`, which is
  the justification being written down for the e2e exemption.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`,
  `apps/website/e2e/booking-flow.integration.spec.ts` — the two specs that stay
  out of the gate.
- `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx` — the file the
  issue names for the negative test.
- `.claude/commands/test.md` — the ADW test phase. Step 5 (`yarn turbo run test`)
  now also runs browser tests; step 7 already runs the e2e specs. Confirms the
  "manually and by the ADW test phase" wording going into `AGENTS.md`.
- `knip.json` — already lists `src/**/*.browser.test.tsx` and `e2e/**/*.ts` as
  website entry points, so no knip change is needed. Verify, do not edit.
- `docs/conditional-docs.md` — index of reference docs by when to read them; the
  `apps/website/ENGINEERING.md` entry gains a condition for "which test layers run
  in CI".

### New Files

None.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the "before" wall time

- From `apps/website`, run `yarn turbo run test --filter=./apps/website --force`
  from the repo root and note the duration and the reported test count.
- Baseline measured while planning: **205 tests, 13 files, ~4.3s** (unit project
  only).
- Keep the number; step 9 reports before/after, which the issue requires.

### 2. Narrow the gated browser run to chromium in `apps/website/vitest.config.ts`

- Above `export default defineConfig(...)`, next to `sharedPlugins`, add:

  ```ts
  /**
   * The gated run (turbo's `test` task, CI, the lefthook pre-push hook) is
   * chromium-only: it has to be installable in the CI image with a single
   * `playwright install chromium` and cheap enough to sit on every push. The
   * full cross-browser sweep stays one command away — `yarn workspace website
   * test:browser` sets VITEST_ALL_BROWSERS=1 — and is run deliberately, not on
   * every push. Webkit in particular cannot launch at all on macOS 14 arm64
   * (Playwright ships a frozen build there), so a push-blocking hook must not
   * depend on it.
   */
  const browserInstances =
    process.env.VITEST_ALL_BROWSERS === "1"
      ? [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }]
      : [{ browser: "chromium" }];
  ```

- Replace the inline `instances: [{ browser: "chromium" }, { browser: "firefox" },
{ browser: "webkit" }],` with `instances: browserInstances,`. Keep the existing
  `// https://vitest.dev/config/browser/playwright` comment above it.
- `headless: true`, the `include` globs and `setupFiles` stay as they are.
  **Corrected after review (patch `cc081a8b`):** this step originally said the
  `optimizeDeps` list stays untouched. It could not. Gating the browser project
  means it runs on a cold `.vite` cache in every CI job and on a developer's
  first push after `yarn install`. With only the original 8 entries, Vite
  discovers `vitest-browser-react`, `next/link`, `next/cache`, `next/headers`,
  `stripe`, `@supabase/supabase-js` and `ical.js` while a test file is being
  imported, re-optimizes, reloads the page and destroys the Vitest runner
  (`Vitest failed to find the runner`). All 7 are now in
  `optimizeDeps.include`. A warm cache masks the failure entirely, so any
  future validation of this project must be run cold.

### 3. Point `apps/website`'s `test` script at both projects

In `apps/website/package.json`:

- `"test": "vitest run --project unit"` → `"test": "vitest run"`.
- `"test:browser": "vitest --project browser"` →
  `"test:browser": "VITEST_ALL_BROWSERS=1 vitest --project browser"`, so the
  manual sweep keeps its current three-browser behaviour (still watch mode, still
  the same command name).
- Leave `test:unit` and `test:integration` exactly as they are.
- Touch no other workspace's `test` script — `yarn test` must keep meaning what it
  means in `apps/guest-communication-agent`, `apps/telegram-router` and
  `packages/pricing`.

### 4. Install chromium in CI before the test step

In `.github/workflows/ci.yml`, insert a step immediately before the existing
`Tests` step (after `Dead code check (knip)`):

```yaml
# The website's `test` script runs the Vitest browser project, which
# launches a real Playwright chromium. `yarn install` does not fetch
# browser binaries, so without this the browser project fails to launch
# in CI. Only chromium: apps/website/vitest.config.ts narrows the gated
# run to it, and the full firefox/webkit sweep is a manual command.
- name: Install Playwright browser (chromium)
  run: yarn workspace website playwright install --with-deps chromium
```

- Use the `yarn workspace website ...` form — the pinned `playwright` binary lives
  in that workspace's devDependencies, and the repo is yarn-only.
- Do not add an e2e/integration step. That layer stays out of CI by decision.

### 5. Record the gate boundary in `apps/website/AGENTS.md`

Append a section (behavioural rules only — no env tables, no architecture):

- Which layers gate: `yarn turbo run test` for this workspace runs **both** the
  `unit` and `browser` Vitest projects. CI (`yarn turbo run test`) and the
  lefthook `pre-push` hook both run it, so a `*.browser.test.tsx` you add is a
  real regression gate from the moment it lands.
- The gated browser run is chromium-only. `yarn workspace website test:browser`
  runs the full chromium/firefox/webkit sweep and is manual. Note that webkit
  cannot launch on macOS 14 arm64 (Playwright ships a frozen build for that
  platform), so the sweep is expected to fail there on webkit alone.
- The Playwright `e2e/` suite is **deliberately not in CI**. It needs a running
  dev server on this run's port, the shared local Supabase, `.env.development`
  and the `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` in-process mocks from
  `src/instrumentation.ts` — none of which exist in the CI image. It runs
  manually via `yarn workspace website test:integration` and automatically as
  step 7 of the ADW test phase (`.claude/commands/test.md`). If you add a spec
  under `e2e/`, it will not re-run in CI; put anything that must gate into a
  `*.unit.test.ts` or `*.browser.test.tsx` instead.
- A new browser test now costs every push a few seconds. Keep them component-
  scoped (mock children), as the existing ones are.

### 6. Refresh the `## Testing` section of `apps/website/ENGINEERING.md`

- In the command list, say which command is the gate:

  ```bash
  yarn test            # vitest unit + browser (chromium) — what CI and pre-push run
  yarn test:unit       # vitest unit only, watch
  yarn test:browser    # vitest browser, all three browsers, watch — manual sweep
  yarn test:integration # Playwright E2E — manual / ADW only, not in CI
  ```

- Add one line under the table noting that the unit and browser rows gate on
  every push and in CI, and the integration row does not.
- Keep the table itself as is; only the surrounding prose and commands change.

### 7. Add the conditional-docs entry

In `docs/conditional-docs.md`, under the `apps/website/ENGINEERING.md` entry, add
a condition: _"When you need to know which test layers run in CI and on push, and
which are manual"_.

### 8. Negative test: prove the gate actually fails

- Temporarily break one assertion in
  `apps/website/src/app/(main)/blog/ui/Breadcrumb.browser.test.tsx` (e.g. change
  the expected `aria-label` string).
- Run `yarn turbo run test --filter=./apps/website --force` and confirm it now
  **fails**, naming the browser project. Push the broken commit so the CI run on
  the PR shows red on the `Tests` step, and confirm the CI log shows the
  `browser (chromium)` project executing.
- Revert the deliberate break (`git revert` or a follow-up commit restoring the
  original assertion), re-run, and confirm green. `git status` must be clean and
  the final diff must contain no trace of the broken assertion.

### 9. Report before/after wall time

In the PR description, state the pre-push cost before and after. Measured while
planning, on this machine:

| Run                                           | Tests          | Files | Duration                                     |
| --------------------------------------------- | -------------- | ----- | -------------------------------------------- |
| Before (`vitest run --project unit`)          | 205            | 13    | ~4.3s                                        |
| After (`vitest run`, unit + chromium browser) | 258            | 20    | ~8.3s                                        |
| Manual sweep (`test:browser`, 3 browsers)     | 53 per browser | 21    | ~60s, webkit cannot launch on macOS 14 arm64 |

- Re-measure on the implementation machine rather than copying these numbers.
- Also confirm the existing browser tests pass **unchanged**: they did under
  `TZ=UTC` (CI's timezone) on chromium — 53 passed — so no test needed an
  environment-dependent fix. Say so explicitly in the PR; if any test does need a
  change, name it and say why it was genuinely environment-dependent.

### 10. Run the validation commands

Run every command in `Validation Commands` and confirm each exits zero.

## Test Coverage

No new test file is warranted, and adding one would be noise: this change adds no
application behaviour. It is a build/CI plumbing change whose entire effect is
_which existing tests run_. The proof it works is the change in what the gate
reports, not a new assertion:

- **Existing `*.browser.test.tsx` (all 7 files, 53 tests) become the coverage this
  chore delivers.** Before the change `yarn turbo run test --filter=./apps/website`
  reports 205 tests in 13 files; after it must report **258 tests in 20 files**.
  That delta is the pass/fail signal, and it is checked in step 10's validation
  run. The issue's stated threshold ("test count > 180") is already met by the
  unit project alone, so use the exact 205 → 258 comparison instead.
- **Negative test (step 8), not a committed test.** A deliberately broken
  assertion in `Breadcrumb.browser.test.tsx` must turn the CI `Tests` step red,
  then be reverted. This is what proves the browser project is genuinely wired in
  rather than silently skipped — a config that fails to match any browser test
  file would otherwise still report "passed".
- **No new `e2e/*.spec.ts`.** Nothing user-visible on `apps/website` changes: no
  route, component, copy or flow is touched. A Playwright journey would exercise
  the same app it exercises today and prove nothing about the gate.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (`knip.json` already lists `src/**/*.browser.test.tsx` as a website entry point, so the newly gated files must not surface as unused)
- `yarn turbo run test --filter=./apps/website --force` - **The core check.** Must report 20 test files / 258 tests (up from 13 / 205) and must list the `browser (chromium)` project. `--force` defeats turbo's cache so the run is real
- `yarn turbo run test --force` - Every workspace's tests still pass; confirms no other workspace's `test` meaning changed
- `yarn turbo run build --filter=./apps/website` - Production build succeeds
- `VITEST_ALL_BROWSERS=1 yarn workspace website vitest run --project browser` - The manual cross-browser sweep still resolves all three instances (expect webkit to fail to launch on macOS 14 arm64; chromium and firefox must pass 53 each). Run the watch-mode `yarn workspace website test:browser` only interactively
- `git status --short` - Clean tree after the step 8 negative test is reverted

## Notes

- **Wall-time budget.** +4s on every `git push` and every CI run, for 53
  assertions that currently gate nothing. The three-browser variant would have
  been +56s and unrunnable on macOS 14 arm64.
- **If the literal `CI`-keyed form is preferred after all**, it is a one-line
  swap in `apps/website/vitest.config.ts` — `process.env.CI ? [{ browser:
"chromium" }] : [all three]` — plus dropping the `VITEST_ALL_BROWSERS=1` prefix
  from `test:browser`. It mirrors `playwright.config.ts` exactly, at the cost of
  making `git push` run firefox and webkit. Do not adopt it without first
  confirming webkit launches on the developer's machine.
- **Why `VITEST_ALL_BROWSERS` and not a fourth npm script.** `test:browser`
  already exists and already means "the browser layer, all of it". Adding
  `test:browser:all` would leave two near-identical scripts and a knip surface;
  an env prefix on the existing script keeps one name per concept.
- **No turbo config change is needed.** The `test` task in `turbo.json` has
  `outputs: []` and no `env` list. `VITEST_ALL_BROWSERS` is never set during a
  turbo run (only by the direct `yarn workspace website test:browser`
  invocation), so it can not perturb turbo's task hash.
- **A warm `.vite` cache is a false green for the browser project.** It hides
  mid-run dependency discovery entirely. Validate cold:
  `rm -rf apps/website/node_modules/.vite && yarn turbo run test
--filter=./apps/website --force`.
- **`vitest.config.ts` is not typechecked** — `apps/website/tsconfig.json`
  excludes it, along with `vitest.browser.setup.ts`. A typo in the instances array
  surfaces as a runtime failure at test start, not as a `tsc` error. Run the test
  command after editing; do not rely on `typecheck`.
- **CI caching of the chromium download** is deliberately left out. The install is
  ~30s; adding an `actions/cache` keyed on the Playwright version is a reasonable
  follow-up if the CI budget tightens, but it adds a cache-invalidation failure
  mode for a small win.
- **Playwright version drift.** `apps/website` pins `playwright` / `@playwright/test`
  at `^1.58.2`; the CI install step resolves whatever the lockfile has, so the
  browser build and the client always match. Keep the install command inside the
  website workspace for exactly that reason — a root-level `yarn playwright
install` would resolve a different binary.
- The ADW test phase (`.claude/commands/test.md`) needs no edit: its step 5 is
  `yarn turbo run test --filter=<TARGET>`, which now covers the browser layer
  automatically, and its step 7 already runs the e2e specs with the run's own
  `PORT`.
