# Patch: Pre-bundle every runtime-discovered dep so the gated browser project survives a cold Vite cache

## Metadata

adw_id: `cc081a8b`
review_change_request: `Issue #1: The newly gated browser project fails on a cold Vite dependency cache, so the gate this chore creates is red in CI rather than green. CI run 35610951589, on this branch's final commit 7ce1a39, fails at the "Tests" step: "Install Playwright browser (chromium)" succeeds and "browser (chromium)" is genuinely executing, but 3 of the 7 browser suites (BookingCalendar, BookingClient, BookingEngineExpanded) abort with "Error: Failed to import test file ... Caused by: Error: Vitest failed to find the runner", preceded by "[vite] (client) new dependencies optimized: vitest-browser-react" and "[vitest] Vite unexpectedly reloaded a test". Root cause: the browser project's optimizeDeps.include in apps/website/vitest.config.ts lists react, react-dom, date-fns, @sentry/nextjs, zod, next/image, next/navigation and posthog-js, but not vitest-browser-react (nor next/link, next/cache, next/headers, stripe, @supabase/supabase-js, ical.js). Vite discovers them mid-run, re-optimizes, and the reload destroys the Vitest runner. Reproduced locally by deleting apps/website/node_modules/.vite and running "yarn turbo run test --filter=./apps/website --force" (exit 1, "Test Files 7 failed | 13 passed (20)"); the immediately following warm run passes 20/20. Every CI job starts from a fresh checkout, and so does any developer's first push after "yarn install". Resolution: add "vitest-browser-react", "next/link", "next/cache", "next/headers", "stripe", "@supabase/supabase-js" and "ical.js" to the browser project's optimizeDeps.include. Verified: with the change applied, three consecutive cold runs all exited 0 with "Test Files 20 passed (20)" and no "unexpectedly reloaded" warning. Validate with a cold cache, not a warm one, and re-run CI on the PR to confirm the "Tests" step is green. Also amend the step 2 note in the spec (which explicitly said optimizeDeps would not change) to record that it did have to change and why. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md`

**Issue:** The chore put the Vitest `browser` project into the gate (turbo `test`,
CI, the lefthook `pre-push` hook), but the project's `optimizeDeps.include` list
in `apps/website/vitest.config.ts` is incomplete. It names 8 dependencies; the
browser suites' real import graph pulls in 7 more that Vite only discovers once
a test file is being imported. On a **cold** Vite dependency cache Vite
re-optimizes mid-run, triggers a page reload, and the reload destroys the Vitest
runner, so suites abort with `Vitest failed to find the runner`. CI run
35610951589 on commit `7ce1a39` failed exactly this way (3 of 7 browser suites);
a local cold run failed 7 of 20 files. A warm cache hides it entirely, which is
why the spec's step 10 validation reported green.

Every CI job is a fresh checkout and every developer's first push after
`yarn install` starts cold, so the gate this chore created is red-or-flaky
rather than green. Severity: blocker.

The optimized-dependency metadata in an existing warm cache
(`apps/website/node_modules/.vite/vitest/*/deps/_metadata.json`) confirms the
list: beyond the 8 already in `include`, Vite ends up optimizing
`vitest-browser-react`, `next/link`, `next/cache`, `next/headers`, `stripe`,
`@supabase/supabase-js` and `ical.js`.

**Solution:** Add those 7 entries to the browser project's
`optimizeDeps.include` array so every dependency is pre-bundled before the first
test file is imported and nothing is discovered mid-run. Then correct the spec's
step 2, which explicitly instructed that `optimizeDeps` stay untouched, so the
record matches what shipped and the next person does not "restore" the bug.

## Files to Modify

Use these files to implement the patch:

- `apps/website/vitest.config.ts` — the browser project's `optimizeDeps.include`
  array (currently 8 entries) gains 7 more. This is the entire functional fix.
- `specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md` —
  step 2's "Change nothing else in the file" bullet is now wrong; it gets
  corrected and the reason recorded.

No other file changes. `apps/website/package.json`, `.github/workflows/ci.yml`,
`lefthook.yml`, `turbo.json` and `knip.json` all stay as the chore left them.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend `optimizeDeps.include` in `apps/website/vitest.config.ts`

- In the second entry of the `test.projects` array (the one with
  `name: "browser"`), replace the existing `optimizeDeps.include` array with the
  full list, keeping the existing 8 entries and appending the 7 missing ones:

  ```ts
  optimizeDeps: {
    // Every dependency the browser suites pull in, listed up front. If Vite
    // discovers one mid-run it re-optimizes and reloads the page, and the
    // reload destroys the Vitest runner - the suite dies with "Vitest failed
    // to find the runner". A warm .vite cache hides this; a cold one (every
    // CI job, every first push after `yarn install`) does not.
    include: [
      "react",
      "react-dom",
      "date-fns",
      "@sentry/nextjs",
      "zod",
      "next/image",
      "next/navigation",
      "next/link",
      "next/cache",
      "next/headers",
      "posthog-js",
      "stripe",
      "@supabase/supabase-js",
      "ical.js",
    ],
  },
  ```

- Every added entry is a real `apps/website` dependency (`next`, `stripe`,
  `@supabase/supabase-js`, `ical.js` in `dependencies`; `vitest-browser-react`
  in `devDependencies`), so all of them resolve.
- Change nothing else in the file: the `browserInstances` constant and its
  comment, `headless: true`, `provider: playwright()`, `instances:
browserInstances`, the `include` globs and `setupFiles` all stay exactly as
  the chore left them.

### Step 2: Add `vitest-browser-react` to the same array

- Keep it grouped with the React entries, at the top of the list, so the array
  reads framework-first:

  ```ts
  include: [
    "react",
    "react-dom",
    "vitest-browser-react",
    // ...the rest, as in step 1
  ],
  ```

- This is the single entry named in the CI failure log
  (`new dependencies optimized: vitest-browser-react`) and it is imported by all
  7 browser test files, so it is the one that must not be missed. It is
  called out separately only for that reason; the end state is one array of 15
  entries.
- Do **not** add `react/jsx-runtime` or `react/jsx-dev-runtime`. They appear in
  the optimized set but are injected by the React plugin / Vitest browser
  defaults before any test file is imported, and the three cold runs cited in
  the review request passed without them.

### Step 3: Correct step 2 of the original spec

In `specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md`,
under `### 2. Narrow the gated browser run to chromium in
apps/website/vitest.config.ts`:

- Replace the final bullet — _"Change nothing else in the file: `headless:
true`, the `optimizeDeps` list, the `include` globs and `setupFiles` all
  stay."_ — with a bullet that says `optimizeDeps.include` **did** have to
  change, and why:

  > - `headless: true`, the `include` globs and `setupFiles` stay as they are.
  >   **Corrected after review (patch `cc081a8b`):** this step originally said
  >   the `optimizeDeps` list stays untouched. It could not. Gating the browser
  >   project means it runs on a cold `.vite` cache in every CI job and on a
  >   developer's first push after `yarn install`. With only the original 8
  >   entries, Vite discovers `vitest-browser-react`, `next/link`,
  >   `next/cache`, `next/headers`, `stripe`, `@supabase/supabase-js` and
  >   `ical.js` while a test file is being imported, re-optimizes, reloads the
  >   page and destroys the Vitest runner (`Vitest failed to find the runner`).
  >   All 7 are now in `optimizeDeps.include`. A warm cache masks the failure
  >   entirely, so any future validation of this project must be run cold.

- Add one line to the spec's `## Notes` section recording that a warm `.vite`
  cache is a false-green for this project, and that the cold-cache command is
  `rm -rf apps/website/node_modules/.vite && yarn turbo run test
--filter=./apps/website --force`.
- Do not restructure or renumber the spec; edit only that bullet and add the
  one note.

### Step 4: Commit and re-run CI on PR #105

- Conventional commit, no `Co-Authored-By` trailer, e.g.
  `fix: pre-bundle browser test deps so the gate survives a cold vite cache`.
- The `pre-push` hook runs the full test suite; let it run against the warm
  cache it will have, then confirm the CI run on PR #105 goes green on the
  `Tests` step. CI is the cold-cache case that matters.
- In the PR description, note that `optimizeDeps.include` had to change against
  the spec's step 2, with the one-line reason (mid-run re-optimization kills the
  runner on a cold cache).

## Validation

Execute every command to validate the patch is complete with zero regressions.

**The cold-cache run is the check that matters — a warm run is a false green.**

- `rm -rf apps/website/node_modules/.vite && yarn turbo run test --filter=./apps/website --force` —
  **the core check.** Must exit 0 and report `Test Files 20 passed (20)` /
  258 tests, list the `browser (chromium)` project, and print **no** `Vite
unexpectedly reloaded a test` and **no** `new dependencies optimized:` line.
  Run this **three times in a row**, deleting `apps/website/node_modules/.vite`
  before each, since the number of suites that abort varies with timing.
- `yarn prettier --check .` — formatting matches the repo config, so the commit
  hook will not reject the edited config and spec
- `yarn turbo run lint --filter=./apps/website` — lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` — types are sound (note:
  `vitest.config.ts` is in `tsconfig.json`'s `exclude` list, so a typo in the
  array surfaces only in the test run above, not here)
- `yarn knip` — no unused files, exports or dependencies introduced
- `yarn turbo run test --force` — every workspace's tests still pass
- `git status --short` — clean tree
- CI run on PR #105 — the `Tests` step is green, and its log shows `browser
(chromium)` executing with all 7 browser suites passing

## Patch Scope

**Lines of code to change:** ~8 added lines in `apps/website/vitest.config.ts`
(7 array entries plus a comment), plus ~12 lines of corrected prose in the spec.

**Risk level:** low — `optimizeDeps.include` only tells Vite to pre-bundle
dependencies it would otherwise pre-bundle on discovery. It changes no test, no
application code and no gate boundary. Every added specifier is an existing
workspace dependency, so none can fail to resolve. The worst case is a slightly
longer cold start for the browser project.

**Testing required:** Three consecutive cold-cache runs of
`yarn turbo run test --filter=./apps/website --force` (deleting
`apps/website/node_modules/.vite` before each) all exiting 0 at 20/20 files with
no reload warning, plus a green `Tests` step on PR #105's CI run. No new test
file — this fixes configuration, adds no behaviour, and the 7 existing browser
suites are themselves the assertion.
