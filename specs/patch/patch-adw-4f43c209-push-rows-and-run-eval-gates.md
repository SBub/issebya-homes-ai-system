# Patch: Push golden rows (a)/(b) to Braintrust and run both eval gates

## Metadata

adw_id: `4f43c209`
review_change_request: `Issue #2: Spec step 13's push ('Push with yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts') was not performed, so two Validation Commands went unverified: the eval gate 'green with rows (a) and (b) passing' and the negative GCA_EVAL_DISABLE_TURN_REPLAY=1 golden-dataset run. A BTQL query against the 'GCA — Golden Dataset' (id 48e31bec-..., EU data plane) returns date-resolution-year-01 still at its 2026-09-21 version (expected get_current_date / alternative run_code, no today field). date-resolution-replay-01 does not exist. Neither ci-gate-evals.ts nor golden-dataset.eval.ts could have exercised the new or updated rows, and nothing on the branch or in the PR records a negative-run result. I verified the underlying behaviour a different way (row (b) returned check_availability(room1, 2026-10-11, 2026-10-13) 3/3 via singleTurnWithMocks), but the spec's gate criterion as written was never evaluated. Resolution: A code patch alone cannot resolve this: it needs a Braintrust write by someone with BRAINTRUST_API_KEY. After fixing issue 1, run yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts from apps/guest-communication-agent. Then run yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts (must be green) and GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts (row (a) Tool Call Match 0), and record both in the PR. Sequencing risk: the dataset is shared with develop's CI gate. develop's executors.ts passes input.messages straight to generateText, so a rows-only row errors there, and the updated row (b) expects check_availability without develop's today line. Push as close to merge as possible, or confirm develop's gate stays above 80% with the two rows added. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-113-adw-4f43c209-sdlc_planner-persist-turn-messages-for-replay.md`
**Issue:** Spec step 13's Braintrust push never ran. The live "GCA — Golden Dataset" still holds the 2026-09-21 `date-resolution-year-01` and has no `date-resolution-replay-01`. So the two eval Validation Commands (gate green with rows (a)/(b) passing; negative `GCA_EVAL_DISABLE_TURN_REPLAY=1` run with row (a) at Tool Call Match 0) were never evaluated against the new rows, and PR #115 records neither result.
**Solution:** No code change. This is an operational step, done in a set order:

1. Commit the issue 1 patch that is already in the working tree (the `OFFER_TEXT` change in `push-date-resolution-rows.ts`), so the pushed rows match the reviewed source.
2. Check that the shared dataset is safe to change (sequencing risk).
3. Upsert the rows.
4. Run the gate and the negative run.
5. Record both results in the PR #115 description.

## Files to Modify

Use these files to implement the patch:

- No repository source files. `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts` already carries the issue 1 fix (uncommitted); it is only committed here, not edited further.
- PR #115 description (GitHub, via `gh pr edit 115 --body-file …`): add an "Eval results" section.
- External state: Braintrust dataset "GCA — Golden Dataset" (project `issebya-homes-ai-system`). The script upserts by id.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Commit the issue 1 fix before pushing anything

- `git diff --stat` must show only `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts`. Its `OFFER_TEXT` must be the date-free "Good news, Room 1 has an opening for 2 nights coming up soon. Shall I send you the booking link?".
- Commit it as `fix(guest-communication-agent): keep replay row dates only in the tool result`. Use a conventional commit with no `Co-Authored-By` trailer. Lefthook's pre-commit must pass.
- Also commit the patch plan files under `specs/patch/`.
- Push the branch, so the PR head matches what gets written to the dataset.

### Step 2: Clear the sequencing risk on the shared dataset

The dataset is shared with develop's eval gate (`.github/workflows/eval-golden.yml`). That gate is informational on `push` to develop and blocking on `pull_request` into master. Develop's `evals/executors.ts` has no `rows` support, so `date-resolution-replay-01` errors there. Develop also has no today line, so `date-resolution-year-01`'s new `check_availability` expectation can miss there.

- Run `gh pr list --base master --state open`. It must be empty. At planning time it was. If a develop→master PR is open, it must merge before the push, or it must include #115. Otherwise its blocking gate runs against rows that its own executors can't handle.
- Push only when #115 is ready to merge: CI green, review approved, and every other blocker resolved. Then merge #115 into develop promptly after Steps 3–5. Develop's informational push-run on that merge then already uses the new executors.
- If the push can't be close to the merge, measure the headroom first. The gate needs Tool Call Match ≥ 80% (`scripts/ci-gate-evals.ts`). Read the last develop "GCA Eval Gate" run: `gh run list --workflow=eval-golden.yml --branch develop -L 1`, then `gh run view <id> --log | grep -i "tool call match"`. Take its average and estimate it with two rows scoring 0. If the result is below 80%, don't push yet. Wait for the merge window.

### Step 3: Upsert the rows into Braintrust

- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts`. `.env.development` holds `BRAINTRUST_API_KEY`.
- Confirm that the output has an `upserted …` line for every id in the script. The script has 8 ids: `date-resolution-vague-01`, `date-resolution-vague-02`, `date-resolution-year-01`, `date-resolution-replay-01`, `date-resolution-year-02`, `check-availability-01-…`, `check-availability-02-…` and `property-question-08-…`.
- Check the write with the Braintrust MCP `sql_query` (BTQL) against the dataset:
  - `date-resolution-replay-01` exists, with `input.rows` and `input.today = "2026-09-22"`.
  - `date-resolution-year-01` now has `input.today = "2026-09-22"`, expects `check_availability` with args `room1`/`2026-10-11`/`2026-10-13`, and has `expectedAlternative: "get_current_date"`.

### Step 4: Run the gate and the negative run

- Gate: `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts`. It must exit 0 with Golden Tool Call Match ≥ 80% and Prompt Injection Security Invariant Held ≥ 90%.
  - In the resulting golden experiment, check `date-resolution-replay-01` and `date-resolution-year-01`. Both should score Tool Call Match 1 on their trials (`trialCount: 3`).
  - If row (a) misses with replay on, don't weaken the expectation. Report the failing tool calls.
- Negative: `cd apps/guest-communication-agent && GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts`. `date-resolution-replay-01` must score 0 on Tool Call Match on all 3 trials.
  - If any trial scores 1, the prose still leaks the dates. That is issue 1's fix failing. Go back to that patch. Don't mark this one done.
- For each run, capture:
  - the experiment link (printed by Braintrust)
  - the overall Tool Call Match
  - row (a)'s per-trial score and tool call
  - row (b)'s per-trial score and tool call

  Pull the per-row numbers with a BTQL query on the experiment, filtered by the row ids.

### Step 5: Record the results in PR #115

- Run `gh pr view 115 --json body -q .body > /tmp/pr115.md`.
- Append an "Eval results" section. It holds:
  - The date the rows were pushed, and that the push ran through `scripts/push-date-resolution-rows.ts`.
  - Gate: the exact command, the experiment link, both gate scores vs thresholds, and row (a)/(b) per-trial results.
  - Negative run: the exact command, the experiment link, and row (a)'s per-trial Tool Call Match (0/0/0) with the tool call each trial made.
  - One line on the sequencing check from Step 2: no open master PRs, and the push was timed to the merge (or the headroom figure).
- Write the file back with `gh pr edit 115 --body-file /tmp/pr115.md`. No em-dashes in the added text.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check . && yarn turbo run lint --filter=./apps/guest-communication-agent && yarn turbo run typecheck --filter=./apps/guest-communication-agent && yarn knip`: the committed tree is clean.
- `yarn turbo run test --filter=./apps/guest-communication-agent`: unit tests pass.
- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts`: every row id prints `upserted`. A BTQL check then shows `date-resolution-replay-01` present and `date-resolution-year-01` with `today: "2026-09-22"`.
- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts`: exits 0, with rows (a) and (b) passing.
- `cd apps/guest-communication-agent && GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts`: row `date-resolution-replay-01` Tool Call Match is 0 on every trial. `gh pr view 115 --json body -q .body | grep -A20 "Eval results"` shows both runs recorded.

## Patch Scope

**Lines of code to change:** 0 (one commit of the already-applied issue 1 fix, plus a PR description section)
**Risk level:** medium. The dataset write is shared with develop's eval gate and isn't versioned in git. Step 2's timing and headroom check limits that risk.
**Testing required:** Braintrust upsert confirmed by BTQL. A green `ci-gate-evals.ts` run with rows (a)/(b) passing. A negative `GCA_EVAL_DISABLE_TURN_REPLAY=1` run with row (a) at 0. Both recorded in PR #115.
