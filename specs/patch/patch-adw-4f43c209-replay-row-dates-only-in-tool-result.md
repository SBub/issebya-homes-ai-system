# Patch: Make golden row date-resolution-replay-01 depend on replayed tool results

## Metadata

adw_id: `4f43c209`
review_change_request: `Issue #1: Golden row (a) date-resolution-replay-01 does not catch the regression it exists to catch. The spec's Validation Commands and Test Coverage require that with GCA_EVAL_DISABLE_TURN_REPLAY=1, row (a) 'must score 0 on Tool Call Match'. Running row (a)'s exact input through evals/executors.ts singleTurnWithMocks 3x with replay on and 3x with GCA_EVAL_DISABLE_TURN_REPLAY=1 returned send_booking_link {guestName:'Ana Silva', email:'ana.silva@example.com', room:'room1', checkIn:'2026-10-06', checkOut:'2026-10-08'} every time. The offer prose says 'October 6 to October 8', and the today line 'Today's date is Tuesday, 2026-09-22 (UTC)' lets the model resolve the year, so text-only replay scores exactly like tool replay. Resolution: redesign row (a) in scripts/push-date-resolution-rows.ts so the ISO dates can only come from the replayed run_code tool-result (e.g. the turn-3 assistant text offers without restating the dates). Keep expected send_booking_link args scored. Run the row both ways (replay on: pass; GCA_EVAL_DISABLE_TURN_REPLAY=1: Tool Call Match 0) and record both outputs in the PR description. memory.test.ts is fine; only the eval row changes. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-113-adw-4f43c209-sdlc_planner-persist-turn-messages-for-replay.md`
**Issue:** In `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts`, row `date-resolution-replay-01` puts the full fact into the prose. `OFFER_TEXT` is "Room 1 is open from October 6 to October 8. …", and it is both the stored `content` of `replay-4` and the final assistant text inside its `turn_messages`. Text-only replay (`GCA_EVAL_DISABLE_TURN_REPLAY=1`) gives the model the month and day from the prose, and the year from the today line. The row passes whether or not `turn_messages` are replayed, so the eval gate can't detect a replay regression.
**Solution:** Change only `OFFER_TEXT` so the offer states no calendar date. The concrete dates `2026-10-06` → `2026-10-08` then exist only in the `run_code` tool-result inside `replay-4.turn_messages`. Use Option 1 from the review. Keep the expected `send_booking_link` args, `expectedAlternative: null` and the rest of the transcript as they are. Rewrite the row's `metadata.description` to match. Upsert the row, run the eval with replay on and with replay off, and record both results for the PR description.

## Files to Modify

Use these files to implement the patch:

- `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts`: the `OFFER_TEXT` constant, the `date-resolution-replay-01` `metadata.description`, and the file's header comment paragraph about date-resolution-replay-01.

No other file changes. `memory.test.ts`, `executors.ts` and the production code stay as they are.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove the dates from the offer prose

- In `scripts/push-date-resolution-rows.ts`, replace `OFFER_TEXT` with an offer that has no month, day, weekday, or relative day count that would pin the date. Use:
  `const OFFER_TEXT = "Good news, Room 1 has an opening for 2 nights coming up soon. Shall I send you the booking link?";`
- Don't mention "Tuesday", "next week", "in two weeks" or similar. With today = 2026-09-22 in the system context, any of these lets the model derive a date without the tool-result. "2 nights" is fine. It matches the tool-result's range but does not fix its start.
- `OFFER_TEXT` is used in two places: `replay-4`'s stored `content` and the last `{ role: "assistant", content: OFFER_TEXT }` entry of its `turn_messages`. Both must change, so text-only replay and tool replay show the same prose. Updating the constant covers both.
- Leave the `run_code` tool-call and its tool-result (`{ room: "room1", checkIn: "2026-10-06", checkOut: "2026-10-08" }`) unchanged. Leave `replay-1`, which carries the guest name and email, unchanged too, so the scored `guestName`/`email` args can still come from the text.

### Step 2: Update the row's description and header comment

- In `date-resolution-replay-01`'s `metadata.description`, replace the "offered 'October 6 to October 8'" wording. It should now say:
  - The reply offered "2 nights coming up soon" without restating the dates.
  - `2026-10-06`/`2026-10-08` exist only in the replayed `run_code` result.
  - With `GCA_EVAL_DISABLE_TURN_REPLAY=1`, the model has no source for the dates. It either re-runs `run_code` or asks, which is a miss, or guesses the dates, which fails the scored args. Either way the row scores 0.
- In the file header, the paragraph starting "date-resolution-replay-01 reproduces the 2026-09-22 incident" should also say that the offer prose deliberately omits the dates, so the row fails without tool replay. Keep it to one sentence and don't use em-dashes.

### Step 3: Upsert the row into the live dataset

- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts`. This upserts by id and overwrites only these rows. Confirm that the output includes `upserted date-resolution-replay-01`.

### Step 4: Prove the row works both ways and record the results

- Row-level check, the same method the reviewer used. Create a throwaway, uncommitted `apps/guest-communication-agent/evals/replay-row-check.tmp.ts`:
  - Copy `storedRow`, `OFFER_TEXT` and `replayRows` from the push script. `replayRows` is not exported, and exporting it would trip knip.
  - Call `singleTurnWithMocks({ contextBlock: "No prior guest information available.", today: "2026-09-22", rows: replayRows })` 3 times.
  - Print each result's tool calls.
  - Run it with `yarn tsx --env-file=.env.development evals/replay-row-check.tmp.ts` and again with `GCA_EVAL_DISABLE_TURN_REPLAY=1` prepended.
  - Expected result with replay on: all 3 runs are `send_booking_link` with `checkIn: "2026-10-06"`, `checkOut: "2026-10-08"`, `room: "room1"`, `guestName: "Ana Silva"`, `email: "ana.silva@example.com"`.
  - Expected result with replay off: no run produces that exact call.
  - Delete the temp file afterwards.
- If replay-on runs stop producing `send_booking_link` with the correct args, don't weaken the expectation. Report it. The spec's positive requirement for row (a) still holds.
- If replay-off runs still produce the exact dates, look for any remaining date hint in the prose, remove it, and repeat Steps 3–4.
- Run the full eval both ways (Validation below) and read row (a)'s "Tool Call Match" in each Braintrust experiment. Record the following for the PR description:
  - Both commands.
  - Both experiment links.
  - Row (a)'s per-trial score and tool call for each run.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check .`: formatting passes.
- `yarn turbo run lint --filter=./apps/guest-communication-agent && yarn turbo run typecheck --filter=./apps/guest-communication-agent && yarn knip`: lint, types and knip are clean, and the temp check file is gone.
- `yarn turbo run test --filter=./apps/guest-communication-agent`: unit tests still pass (no code change expected to affect them).
- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts`: the eval gate is green. Row `date-resolution-replay-01` passes (Tool Call Match 1 on its trials).
- `cd apps/guest-communication-agent && GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts`: row `date-resolution-replay-01` scores 0 on "Tool Call Match" on every trial. Record the result in the PR description.

## Patch Scope

**Lines of code to change:** ~6 (one constant, one description string, one header comment sentence)
**Risk level:** low
**Testing required:** Upsert the row. Run row (a) 3x with replay on (must pass) and 3x with `GCA_EVAL_DISABLE_TURN_REPLAY=1` (must miss). Run the full eval gate green, and the full negative eval with row (a) at Tool Call Match 0. Record both results in the PR.
