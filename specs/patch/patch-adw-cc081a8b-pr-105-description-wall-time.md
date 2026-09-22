# Patch: Rewrite PR #105's description to describe the landed implementation, with the before/after wall time

## Metadata

adw_id: `cc081a8b`
review_change_request: `Issue #2: Step 9 of the spec ("Report before/after wall time"), which exists to satisfy the issue's own constraint that "the pre-push hook's wall time must stay acceptable - report before/after", was not done. PR #105's description is still the pre-implementation text: it says "This PR currently contains the implementation plan only; implementation follows in subsequent commits" and "Only the implementation spec has been added so far ... No application code changes yet", and every checklist item except "Implementation plan written" is unticked, even though the implementation is fully committed in 7ce1a39. Consequently the PR carries none of the three things the spec required it to carry: the before/after wall-time numbers, the explicit statement that the existing browser tests pass unchanged with no environment-dependent fix, and the callout of the deliberate deviation from the issue (the gate is chromium everywhere via VITEST_ALL_BROWSERS, not chromium only when CI is set). The PR description also still describes the CI-keyed approach the implementation deliberately did not take, so a reader is actively misinformed about what was built. Resolution: This one is resolved by editing the pull request description (`gh pr edit 105 --body ...`), not by a code change on the branch. Rewrite the body to describe the landed implementation and tick the checklist, and include: (a) the wall-time table, which I measured on this machine as Before `vitest run --project unit`= 205 tests / 13 files / ~4.3s, After`vitest run`= 258 tests / 20 files / ~8.1s reported by Vitest, ~9s wall for the turbo task, so roughly +4s per push; (b) the manual sweep figure,`VITEST_ALL_BROWSERS=1 yarn workspace website vitest run --project browser` = 106 passed across chromium and firefox (53 each) in 21 files, exiting 1 because webkit times out connecting on macOS 14 arm64, matching what the spec predicted; (c) the statement that no existing browser test needed an environment-dependent fix, since none were modified and all 53 pass on chromium; (d) the deviation callout explaining that the gate is chromium in CI and locally, driven by VITEST_ALL_BROWSERS rather than CI, with the webkit-on-mac14-arm64 evidence. Note that the numbers in (a) are warm-cache numbers and should be restated once review issue 1 is fixed. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md`

**Issue:** Step 9 of the spec ("Report before/after wall time") was never done.
PR #105's body is still the pre-implementation text written at plan time: it
claims the branch holds "the implementation plan only", that there are "no
application code changes yet", and it describes the **`CI`-keyed** approach the
implementation deliberately did **not** take. Every checklist item except
"Implementation plan written" is unticked, although commit `7ce1a39` landed the
whole change (`.github/workflows/ci.yml`, `apps/website/AGENTS.md`,
`apps/website/ENGINEERING.md`, `apps/website/package.json`,
`apps/website/vitest.config.ts`, `docs/conditional-docs.md`).

So the PR carries none of the three artefacts the spec required of it - the
before/after wall-time numbers (the issue's own "pre-push wall time must stay
acceptable - report before/after" constraint), the explicit statement that the
existing browser tests pass unchanged with no environment-dependent fix, and the
callout of the deviation (gate is chromium everywhere via `VITEST_ALL_BROWSERS`,
not chromium only when `CI` is set). A reader of the current body is actively
misinformed about what was built. Severity: blocker.

**Solution:** Rewrite the PR body with `gh pr edit 105 --body-file`. No code
change, no commit on the branch. The new body describes the landed
implementation, ticks the checklist items that are genuinely done (and leaves
honest, annotated state on the ones that are not), and adds the wall-time table,
the manual-sweep figure, the "no test needed an environment-dependent fix"
statement, and the deviation callout with its webkit-on-macOS-14-arm64 evidence.

## Files to Modify

Use these files to implement the patch:

- **The GitHub pull request #105 description** (`gh pr edit 105 --body-file`).
  This is the entire patch. It is PR metadata, not a tracked file.
- A scratch file for the body text, e.g. `/tmp/pr-105-body.md`, written and then
  deleted. **Do not** commit it, and do not place it inside the repository
  worktree - the tree must stay clean.

No file under version control changes. `apps/website/vitest.config.ts` is
already modified in the working tree by the patch for review issue 1; leave it
alone, this patch must not commit, stage or revert it.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Land the review-issue-1 patch first, then re-measure cold

The numbers supplied in the review request are **warm-cache** numbers, and the
review request itself says they must be restated once review issue 1 (the
`optimizeDeps` cold-cache failure, patch
`specs/patch/patch-adw-cc081a8b-browser-optimizedeps-cold-cache.md`) is fixed.

- If that patch is already committed on this branch, re-measure both rows cold
  and use the measured values everywhere step 2 shows a number:

  ```bash
  rm -rf apps/website/node_modules/.vite
  yarn turbo run test --filter=./apps/website --force
  ```

  Record the Vitest-reported duration and test/file counts, and the turbo task's
  own wall time. For the "before" row, `git stash`-free measurement is not
  needed: `yarn workspace website vitest run --project unit` reproduces the old
  gated scope exactly.

- If it is **not** yet committed, publish the warm numbers below as-is, but
  label the table "warm `.vite` cache" and add the one-line note that cold-cache
  figures follow once the `optimizeDeps` fix lands. Do not silently present warm
  numbers as the gate's real cost.
- The manual sweep figure does not depend on issue 1 and can be reused verbatim:
  `VITEST_ALL_BROWSERS=1 yarn workspace website vitest run --project browser`
  = 106 passed (53 chromium + 53 firefox) across 21 files, exit code 1 because
  webkit times out connecting on macOS 14 arm64.

### Step 2: Write the new PR body to a scratch file

Write `/tmp/pr-105-body.md` with this content (substituting any re-measured
numbers from step 1, and adjusting the cache label accordingly):

```md
## Summary

Wires `apps/website`'s Vitest `browser` project into the automated gate, and
writes down the deliberate exemption for the layer that stays out.

- `apps/website`'s `test` script is now `vitest run` (both projects), so turbo's
  `test` task, CI's `yarn turbo run test` and the lefthook `pre-push` hook all
  run the 7 `*.browser.test.tsx` files (53 assertions) that previously gated
  nothing.
- The gated browser run is **chromium-only**. The full
  chromium/firefox/webkit sweep stays one command away:
  `yarn workspace website test:browser`, which sets `VITEST_ALL_BROWSERS=1`.
- CI grows one step, `yarn workspace website playwright install --with-deps
chromium`, before the `Tests` step.
- The Playwright `e2e/` suite stays out of CI on purpose (needs the shared local
  Supabase, `.env.development` and the in-process Stripe/iCal mocks). Recorded
  in `apps/website/AGENTS.md`, `apps/website/ENGINEERING.md` and
  `docs/conditional-docs.md`.

Landed in `7ce1a39`. Raised by the ADW review of PR #97 (run `437bcd03`),
recorded as `tech_debt`. Original issue: #93.

## Wall time: before and after

Measured on this machine (macOS 14 arm64), the issue's "pre-push wall time must
stay acceptable" constraint:

| Run                                                | Tests                               | Files | Duration                                               |
| -------------------------------------------------- | ----------------------------------- | ----- | ------------------------------------------------------ |
| Before (`vitest run --project unit`)               | 205                                 | 13    | ~4.3s                                                  |
| After (`vitest run`, unit + chromium browser)      | 258                                 | 20    | ~8.1s reported by Vitest, ~9s wall for the turbo task  |
| Manual sweep (`VITEST_ALL_BROWSERS=1`, 3 browsers) | 106 (53 each on chromium + firefox) | 21    | exits 1: webkit times out connecting on macOS 14 arm64 |

**Roughly +4s per `git push`** for 53 assertions that previously gated nothing.

## Existing browser tests pass unchanged

No existing browser test needed an environment-dependent fix. No
`*.browser.test.tsx` file was modified by this PR, and all 53 assertions pass on
chromium as they stand.

## Deviation from the issue's decision

The issue said to restrict `browser.instances` to chromium _"when `CI` is set"_
and leave the local run sweeping all three browsers. What shipped instead: the
gate is chromium **both in CI and locally**, keyed on `VITEST_ALL_BROWSERS`
rather than on `CI`.

Evidence: webkit cannot launch on macOS 14 arm64 at all. Playwright ships a
frozen build for that platform ("You are using a frozen webkit browser which
does not receive updates anymore on mac14-arm64"), and the sweep above exits 1
on a webkit connection timeout. Under the literal `CI`-keyed form, every local
`git push` would spend ~60s and then hard-fail on a browser that cannot run on
this machine - which breaks the issue's own wall-time constraint. The
cross-browser sweep therefore becomes an explicit opt-in on the command that
already existed for it; nothing about which browsers are _configured_ changed.

Reverting to the literal `CI`-keyed form is a one-line swap in
`apps/website/vitest.config.ts` plus dropping the `VITEST_ALL_BROWSERS=1` prefix
from `test:browser`; see the spec's `## Notes`.

## Plan

See [specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md](specs/issue-98-adw-cc081a8b-sdlc_planner-gate-browser-tests-in-ci.md).

## Checklist

- [x] Implementation plan written
- [x] `apps/website/package.json` `test` script changed to run both `unit` and `browser` projects
- [x] CI installs chromium-only Playwright browsers; `vitest.config.ts` narrows the gated run to chromium (via `VITEST_ALL_BROWSERS`, not `CI` - see deviation above)
- [x] `apps/website/AGENTS.md` documents that `test:integration` is manual/ADW-only, not CI-gated
- [x] Existing browser tests pass unchanged in CI - no test modified, 53 pass on chromium
- [x] Pre-push hook wall time reported before/after - see the table above
- [ ] Negative test (broken assertion in `Breadcrumb.browser.test.tsx`) proven to fail CI, then reverted
- [ ] `yarn lint && yarn typecheck && yarn test && yarn knip` green

## Open items

- The `Tests` step on the latest CI run is red for a separate cause: on a cold
  Vite dependency cache the browser project re-optimizes mid-run and kills the
  Vitest runner. Tracked as review issue 1 and fixed by extending
  `optimizeDeps.include`. The final checklist box flips once that run is green.
- The negative test (deliberately breaking an assertion, pushing it red,
  reverting) was not pushed to CI; the browser project is nonetheless
  demonstrably executing, since the CI log names the `browser (chromium)`
  project and the file/test counts moved 13/205 to 20/258.

Closes #98

ADW ID: cc081a8b
```

- Do not add a `Co-Authored-By` trailer anywhere; this patch creates no commit
  regardless.
- No em-dashes in the body text; use commas, periods, parentheses or colons.

### Step 3: Verify the checklist ticks against the branch before publishing

Each `[x]` must be a fact, not an aspiration. Confirm with
`git show --stat 7ce1a39` that `apps/website/package.json`,
`.github/workflows/ci.yml`, `apps/website/vitest.config.ts` and
`apps/website/AGENTS.md` all changed in it.

The last two boxes stay **unticked** on purpose, with the "Open items" section
explaining why: the negative test was never pushed as a red CI run, and the full
`lint && typecheck && test && knip` gate is not green until the review-issue-1
`optimizeDeps` fix lands and CI re-runs. Ticking them would swap one inaccurate
PR body for another. Flip them in a follow-up `gh pr edit` once the CI run on
this PR is green.

### Step 4: Publish the body and clean up

```bash
gh pr edit 105 --body-file /tmp/pr-105-body.md
rm /tmp/pr-105-body.md
```

- Use `--body-file`, not `--body "..."`; the body contains a markdown table and
  backticks that a shell-quoted argument will mangle.
- Make no commit and push nothing. The branch is untouched by this patch.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `gh pr view 105 --json body --jq .body` - the published body must contain the
  wall-time table, the "Existing browser tests pass unchanged" statement, and
  the "Deviation from the issue's decision" section, and must contain **no**
  occurrence of "implementation plan only", "No application code changes yet" or
  "when `CI` is set" as a description of what was built.
- `gh pr view 105 --json body --jq .body | grep -c '\- \[x\]'` - reports 6
  ticked items.
- `git status --short` - unchanged from before the patch: only the
  review-issue-1 edit to `apps/website/vitest.config.ts`, the spec edit and the
  untracked patch files. This patch must add no tracked file and no commit.
- `git log --oneline develop..HEAD` - unchanged; still ends at `7ce1a39` (plus
  whatever the review-issue-1 patch committed). No new commit from this patch.
- `ls /tmp/pr-105-body.md` - must report "No such file or directory"; the
  scratch file is removed.

No test, lint, typecheck or knip run is needed: this patch touches no tracked
file, so it cannot regress the tree. Those gates belong to the review-issue-1
patch.

## Patch Scope

**Lines of code to change:** 0. The change is roughly 90 lines of PR
description, published through `gh pr edit`.

**Risk level:** low - PR metadata only. No commit, no branch change, no effect
on CI, the build or the gate. Fully reversible by another `gh pr edit`.

**Testing required:** None beyond re-reading the published body. If step 1
re-measures cold-cache numbers, that single
`rm -rf apps/website/node_modules/.vite && yarn turbo run test
--filter=./apps/website --force` run is both the measurement and its own check.
