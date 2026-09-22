# Patch: Rewrite PR #115's description to match the branch and record the eval results

## Metadata

adw_id: `4f43c209`
review_change_request: `Issue #1: The spec's Validation Commands say of the negative run "Record in the PR how it was run and its result". Patch plan step 5 also required an "Eval results" section in PR #115. Neither was done: the PR #115 body at HEAD 935f129 still says "This PR currently contains the implementation plan only, no application code yet", and every checklist item after the plan is unchecked. The runs did happen, and their results only exist in Braintrust. (1) The golden dataset 48e31bec now holds date-resolution-replay-01 and the updated date-resolution-year-01, both with today=2026-09-22 and the date-free OFFER_TEXT. (2) Gate run A: golden experiment a3ac357c scored Tool Call Match 89.9% on 89 scored trials, with 70 trials errored on OpenRouter credits. Its prompt-injection experiment 47f45a18 errored on all 3 trials. (3) Gate run B: golden experiment 1b411d5e scored 84.0%, but on only 25 scored trials (134 of 159 errored on credits). Its injection experiment d04dbf63 scored Security Invariant Held 100% on 30 of 30 trials. (4) Row (a) scored Tool Call Match 1 on all 3 trials in both A and B, calling send_booking_link(room1, 2026-10-06, 2026-10-08, Ana Silva, ana.silva@example.com). Row (b) scored 1 on all 3 trials in both runs, calling check_availability(room1, 2026-10-11, 2026-10-13), sometimes after get_current_date. (5) Negative run 4bf87289 (GCA_EVAL_DISABLE_TURN_REPLAY=1): row (a) scored 0 on 2 trials. One re-ran run_code; the other called send_booking_link with 2026-09-23 to 2026-09-25. The third trial errored on credits. So the spec's criteria hold on the evidence, but the record the spec requires is missing, and the PR description tells a reviewer the opposite of what the branch contains. Resolution: This can be fixed on the branch without new code. Rewrite the PR #115 description with gh pr view 115 --json body -q .body, edit it, then gh pr edit 115 --body-file <file>. (1) Replace the "implementation plan only" section and the stale checklist with what the branch actually contains. (2) Add an "Eval results" section giving the push command (scripts/push-date-resolution-rows.ts, rows upserted 2026-09-22 22:28 UTC). Give the gate command (scripts/ci-gate-evals.ts) with golden experiment 1b411d5e plus injection experiment d04dbf63 (Tool Call Match 84.0%, Security Invariant Held 100%), and golden experiment a3ac357c (89.9%). Give per-trial results for rows (a) and (b) (3/3 each, in both golden runs). Give the negative command (GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts), experiment 4bf87289, and row (a) scoring 0 and 0, with the third trial errored. (3) State that most trials in these runs errored on OpenRouter credit exhaustion. If credits allow, re-run scripts/ci-gate-evals.ts so the gate is judged on a mostly error-free run, and record that run too. Use no em-dashes in the added text. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-113-adw-4f43c209-sdlc_planner-persist-turn-messages-for-replay.md`
**Issue:** PR #115's body is still the plan-time text. It says the branch holds "the implementation plan only, no application code yet" and leaves every checklist item after the plan unticked, although commits `34b0941` and `490ecba` landed the implementation. The spec's Validation Commands require the negative run to be recorded in the PR, and the earlier patch (`patch-adw-4f43c209-push-rows-and-run-eval-gates.md`, Step 5) required an "Eval results" section. The push, both gate runs and the negative run happened, but their results live only in Braintrust.
**Solution:** No code change and no commit of application code. Rewrite the PR #115 description with `gh pr edit 115 --body-file`. Replace the stale "Current state" section and checklist with what the branch contains, and add an "Eval results" section with the numbers from the review. Say plainly that most trials errored on OpenRouter credit exhaustion. If credits now allow, re-run `scripts/ci-gate-evals.ts` once and record that run as well.

## Files to Modify

Use these files to implement the patch:

- **PR #115 description** on GitHub (`gh pr edit 115 --body-file …`). This is the whole patch. It is PR metadata, not a tracked file.
- A scratch body file at `/tmp/pr115-body.md`, outside the worktree. Do not commit it. The git tree must stay clean.

No file under version control changes.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Pull the current body and confirm what the branch contains

- `gh pr view 115 --json body -q .body > /tmp/pr115-body.md`.
- `git log --oneline develop..HEAD` and `git diff --stat develop...HEAD -- apps/guest-communication-agent supabase` to list what landed. Tick a checklist item only if the branch actually does it. Confirm each against the code:
  - Migration `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql` (`turn_messages jsonb` + partial unique index on assistant `trace_id`).
  - Turn tail persisted on the assistant row (`src/agent/turn-messages.ts`, `src/lib/conversations.ts`, `src/lib/db.ts`).
  - Replay of stored turn messages in `src/agent/memory.ts`, with `trimToTokenBudget` in `src/agent/context.ts` now dropping whole turn groups and the budget raised to 8000/6000 tokens. Describe the replay as implemented, not as the plan's "three-tier" wording, if they differ.
  - Today line appended to per-turn context (`src/agent/tools/current-date.ts`, `src/agent/run-agent-turn.ts`).
  - `past_date` refusal text in `src/agent/tools/booking.ts` now points the model back at its earlier tool result.
  - Tool-output cap of 2,000 chars (`TOOL_OUTPUT_MAX_CHARS` in `turn-messages.ts`) and redaction of replayed content.
  - Golden rows (a) `date-resolution-replay-01` and (b) `date-resolution-year-01` in `scripts/push-date-resolution-rows.ts`, `input.rows` / `input.today` support in `evals/executors.ts` and `evals/types.ts`, and the eval-only `GCA_EVAL_DISABLE_TURN_REPLAY` switch.
- Leave "Post-deploy WhatsApp replay verification" unticked, annotated as manual and owner-driven after deploy (spec's last Validation Command).
- Leave the `yarn lint && yarn typecheck && yarn test && yarn knip` item ticked only if Step 4's validation passes on HEAD.

### Step 2: If credits allow, run the gate once more

- Check OpenRouter credit first: `cd apps/guest-communication-agent && set -a && . ./.env.development && set +a && curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits`. If remaining credit (`total_credits - total_usage`) is clearly too low for ~160 golden trials plus 30 injection trials, skip the rest of this step and say so in the PR.
- Otherwise: `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts`. Note the exit code, both experiment ids, Golden Tool Call Match, Prompt Injection Security Invariant Held, and the number of scored vs errored trials.
- With the Braintrust MCP `sql_query` (BTQL) on the new golden experiment, pull the per-trial Tool Call Match score and tool calls for `date-resolution-replay-01` and `date-resolution-year-01`.
- If row (a) or (b) scores 0 on any trial, record it as is. Do not edit the rows or expectations in this patch.

### Step 3: Rewrite the body

Edit `/tmp/pr115-body.md`:

- Keep the existing "Summary" section, the plan link, `Closes #113` and the ADW tracking id.
- Replace "Current state of the branch" with a short "What this PR contains" list naming the pieces confirmed in Step 1, with commits `34b0941` (implementation) and `490ecba` (date-free `OFFER_TEXT` in the replay row).
- Replace the checklist with the Step 1 result.
- Add an "Eval results" section, with no em-dashes anywhere in the added text:
  - **Dataset push:** `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts`, rows upserted 2026-09-22 22:28 UTC into "GCA Golden Dataset" (`48e31bec`). `date-resolution-replay-01` added and `date-resolution-year-01` updated, both with `today: 2026-09-22` and the date-free `OFFER_TEXT`.
  - **Credit caveat, stated up front:** most trials in runs A, B and the negative run errored on OpenRouter credit exhaustion, so the aggregate scores rest on a fraction of the trials.
  - **Gate command:** `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts` (thresholds: Tool Call Match >= 80%, Security Invariant Held >= 90%).
    - Run B: golden `1b411d5e`, Tool Call Match 84.0% on 25 scored trials (134 of 159 errored); injection `d04dbf63`, Security Invariant Held 100% on 30 of 30 trials.
    - Run A: golden `a3ac357c`, Tool Call Match 89.9% on 89 scored trials (70 errored); injection `47f45a18` errored on all 3 trials, so run A's injection gate has no score.
    - Step 2's run, if it happened: same fields, plus scored vs errored counts. If it was skipped, one line saying why.
  - **Rows (a) and (b), per trial**, a small table:
    - Row (a) `date-resolution-replay-01`: 1/1/1 in run A and 1/1/1 in run B, each calling `send_booking_link(room1, 2026-10-06, 2026-10-08, Ana Silva, ana.silva@example.com)`.
    - Row (b) `date-resolution-year-01`: 1/1/1 in run A and 1/1/1 in run B, each calling `check_availability(room1, 2026-10-11, 2026-10-13)`, sometimes after `get_current_date`.
  - **Negative run:** `cd apps/guest-communication-agent && GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts`, experiment `4bf87289`. Row (a) scored 0 and 0: one trial re-ran `run_code`, the other called `send_booking_link` with 2026-09-23 to 2026-09-25. The third trial errored on credits. So with replay off, the model cannot recover the dates, which is what the row is meant to prove.
- Check the added text for em-dashes: `grep -n "—" /tmp/pr115-body.md` must match only lines kept from the original Summary.

### Step 4: Publish and clean up

- `gh pr edit 115 --body-file /tmp/pr115-body.md`.
- `rm /tmp/pr115-body.md`.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `git status --short`: empty. No tracked file changed.
- `gh pr view 115 --json body -q .body | grep -c "implementation plan only"`: prints `0`.
- `gh pr view 115 --json body -q .body | grep -A40 "Eval results"`: shows the push command and time, experiments `1b411d5e`, `d04dbf63`, `a3ac357c`, `47f45a18`, `4bf87289`, the per-trial rows (a)/(b), the negative command, and the credit-exhaustion caveat (plus the Step 2 run or the reason it was skipped).
- `gh pr view 115 --json body -q .body | sed -n '/What this PR contains/,$p' | grep -c "—"`: prints `0`.
- `yarn prettier --check . && yarn turbo run lint --filter=./apps/guest-communication-agent && yarn turbo run typecheck --filter=./apps/guest-communication-agent && yarn knip && yarn turbo run test --filter=./apps/guest-communication-agent`: passes on HEAD, backing the ticked quality-gate checklist item.

## Patch Scope

**Lines of code to change:** 0 (PR description only)
**Risk level:** low. PR metadata only. The optional gate re-run reads the shared golden dataset but does not write to it.
**Testing required:** Confirm the new PR body via `gh pr view`, and that the workspace quality gates pass on HEAD. Optionally, one fresh `ci-gate-evals.ts` run if OpenRouter credit allows.
