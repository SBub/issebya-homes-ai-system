# Feature: First-turn marker so the GCA's AI disclosure fires deterministically

## Metadata

issue_number: `128`
adw_id: `5817232d`
issue_json: `{"number":128,"title":"GCA: put a first-turn marker into the model context so the AI disclosure fires deterministically on a new conversation"}`

## Feature Description

The Braintrust system prompt `gca-system` has an "AI disclosure" rule: on the guest's first message in a new conversation, the reply opens with a short self-introduction that says it is an AI assistant, and that introduction is never repeated. Today the model has to work out "is this the first message?" from the shape of the history, and it gets it wrong. In prod on 2026-09-23 at 20:00:48 UTC a brand-new conversation's first reply ("Both rooms are free October 6-8. Here's a quick comparison: ...") had no introduction.

This feature moves the "which turn is this" fact out of the model's inference and into code. `run-agent-turn.ts` already appends `buildTodayLine()` after the Braintrust prompt, so the date rule no longer depends on the model working out the date (issue #113). The same approach applies here. When the conversation has no prior assistant row, one extra system line is appended: `This is the guest's first message in this conversation. Begin your reply with the AI disclosure described in your instructions.` On every later turn nothing is appended.

The code line says _when_. The Braintrust prompt still says _what_ (the owner is rewording it separately). The prompt is not pinned or edited from code.

## User Story

As a guest messaging Issebya Homes on WhatsApp for the first time
I want the first reply to tell me I'm talking to an AI concierge
So that I know who (or what) I'm dealing with before sharing booking details, without hearing the same introduction on every later message

## Problem Statement

The disclosure is a legal and trust requirement, and right now it depends on the model inferring "first message" from an empty history. That inference is unreliable. There is a second trap as well. The model's `messages` array is not actually empty on a first turn when the guest has stored preferences or a prior fold, because `memory.ts`'s `buildMemoryMessage` prepends a `role: "assistant"` summary message. So a "no assistant message in what the model sees" heuristic, whether the model applies it or code does, gives the wrong answer for returning guests whose conversation was wiped.

## Solution Statement

1. **The fact, computed once, from data already loaded.** `memory.ts`'s `loadMemoryState` already fetches every recent `whatsapp_messages` row for the conversation (`loadRecentMessages`, up to 150 rows) _before_ it filters by watermark and trims to the token budget. Compute `hasAssistantHistory = rows.some((r) => r.role === "assistant")` over those **raw fetched rows** and return it on `AgentMemory`. This matches the issue's contract definition ("the conversation has no prior assistant row in `whatsapp_messages`") and adds no query. It stays correct in the two cases where the _trimmed_ `historyMessages` might contain no assistant message even though one exists:
   - earlier assistant rows already folded into `guest_memory_folds` (they sit before the watermark and are filtered out of `historyMessages`)
   - earlier groups dropped by `trimToTokenBudget`

   It deliberately ignores `memoryMessage`. That message is `role: "assistant"` but is per-phone, cross-conversation memory, not a reply in this conversation.

2. **The line.** A new pure module `src/agent/first-turn.ts` exports `buildFirstTurnLine(hasAssistantHistory: boolean): string | null`. It returns the fixed line when `hasAssistantHistory` is false and `null` otherwise. A second helper, `hasAssistantMessage(messages: ModelMessage[]): boolean`, is exported for the eval executor, which only has `ModelMessage[]` and not raw rows.
3. **The wiring.** `run-agent-turn.ts` builds `system` as the Braintrust prompt, then `buildTodayLine()`, then the first-turn line when non-null, joined by blank lines. `system` is already outside every `step.run`. `hasAssistantHistory` comes from the memoized `load-memory` step, so a turn that resumes after a `missing_info` suspend sees the same value. The line goes into the `system` string, not `messages`, so it never touches `trimToTokenBudget`'s history budget.
4. **Evals.** The eval executor appends the same line the same way, with an eval-only kill switch `GCA_EVAL_DISABLE_FIRST_TURN_LINE=1` (same pattern as `GCA_EVAL_DISABLE_TURN_REPLAY`) so the required negative run can be done. A new deterministic scorer, "AI Disclosure", checks the opening of the reply for the word "AI". It returns `null` (skipped) for rows with no disclosure expectation, so it does not dilute or affect existing rows. Two new golden rows go in via a reviewed push script modelled on `scripts/push-date-resolution-rows.ts`.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md`: repo rules (yarn only, conventional commits, filter by path).
- `apps/guest-communication-agent/AGENTS.md`: GCA rules. Comment only genuine landmines, no narrative comments, and pass named functions into `steppedSpan`.
- `apps/guest-communication-agent/ENGINEERING.md`: agent loop, memory and eval design. Section 7 (Evaluation) must gain one line about the disclosure rows and scorer.
- `apps/guest-communication-agent/app_docs/feature-4f43c209-turn-message-replay.md`: how history is loaded, grouped and trimmed, and how golden rows replay stored `whatsapp_messages` rows (conditional-docs match: changing what `memory.ts` loads, adding a replay row).
- `apps/guest-communication-agent/src/agent/run-agent-turn.ts`: where `system` is built (`const system = \`${promptText}\n\n${buildTodayLine()}\``, ~line 218) and where `loadMemory`'s result is destructured (~line 175). The line is appended here.
- `apps/guest-communication-agent/src/agent/memory.ts`: `AgentMemory` interface, `loadMemoryState` (raw `rows` available before watermark filtering and trim), `loadMemory`. Gains `hasAssistantHistory`.
- `apps/guest-communication-agent/src/agent/tools/current-date.ts`: `buildTodayLine`, the precedent to mirror (a pure builder with a doc comment saying run-agent-turn appends it after the Braintrust prompt).
- `apps/guest-communication-agent/src/agent/context.ts`: `trimToTokenBudget`/`estimateTokens`. Read-only here, to confirm the line (in `system`) is outside the budget.
- `apps/guest-communication-agent/src/lib/db.ts`: `MessageRow`, `loadRecentMessages` (150-row window). Read-only.
- `apps/guest-communication-agent/evals/executors.ts`: `singleTurnWithMocks` builds `system` the same way production does and `evalMessages` builds the message list. Must append the first-turn line.
- `apps/guest-communication-agent/evals/types.ts`: `EvalInput` and `ExpectedShape`. Gain an optional `firstTurn` override and an optional `aiDisclosure` expectation.
- `apps/guest-communication-agent/evals/evaluators.ts`: `toolCallMatch`/`securityInvariantHeld` and the local `Score` type. The new `aiDisclosure` scorer goes here.
- `apps/guest-communication-agent/evals/golden-dataset.eval.ts`: register the new scorer next to `toolCallMatch`.
- `apps/guest-communication-agent/scripts/ci-gate-evals.ts`: print the new scorer's average as informational (not a gate; see Notes).
- `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts`: the model for the new push script (the `storedRow` helper, `Dataset.insert` upsert by explicit id, tool-call/tool-result message shapes).
- `apps/guest-communication-agent/tests/agent/memory.test.ts`: existing `loadMemory` tests (mocked `loadRecentMessages`/`getGuestMemory`/`loadGuestMemoryFolds`). Extended for `hasAssistantHistory`.
- `apps/guest-communication-agent/tests/agent/run-agent-turn.test.ts`: existing tests assert on the `system` string passed to the model and mock `loadMemory`. Extended for the line's presence and absence.
- `apps/guest-communication-agent/tests/agent/run-guest-turn.test.ts`: mocks `loadMemory` (`{ historyMessages, memoryMessage: null }`). The mock must gain `hasAssistantHistory` so the types stay sound.
- `apps/guest-communication-agent/tests/evals/evaluators.test.ts`: existing scorer tests. Extended for `aiDisclosure`.
- `docs/conditional-docs.md`: add an entry for the new app_docs file if `/document` creates one.

### New Files

- `apps/guest-communication-agent/src/agent/first-turn.ts`: `FIRST_TURN_LINE`, `buildFirstTurnLine(hasAssistantHistory)`, `hasAssistantMessage(messages)`.
- `apps/guest-communication-agent/tests/agent/first-turn.test.ts`: unit tests for both helpers.
- `apps/guest-communication-agent/scripts/push-ai-disclosure-rows.ts`: upserts the two `ai-disclosure-*` golden rows.

## Implementation Plan

### Phase 1: Foundation

Add the pure `first-turn.ts` module and its unit tests. Extend `AgentMemory` with `hasAssistantHistory`, computed in `loadMemoryState` from the raw fetched rows, and thread it through `loadMemory`'s return value. Update the two test files that mock `loadMemory` so they still typecheck.

### Phase 2: Core Implementation

In `run-agent-turn.ts`, destructure `hasAssistantHistory` from the `load-memory` step result and build `system` from the prompt, the today line and the optional first-turn line. Add tests that pin the exact `system` string on a first turn and prove the line is absent on a later turn and that `messages` are unchanged.

### Phase 3: Integration

Mirror the line in the eval executor, add the `firstTurn` override, the `aiDisclosure` expectation, the "AI Disclosure" scorer and the kill switch. Write and run the push script for the two golden rows. Run the golden eval with and without the line and record the pass counts. Update ENGINEERING.md section 7.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions

- Read `AGENTS.md`, `apps/guest-communication-agent/AGENTS.md`, `apps/guest-communication-agent/ENGINEERING.md` sections on memory and evaluation, and `apps/guest-communication-agent/app_docs/feature-4f43c209-turn-message-replay.md`.

### 2. Create `src/agent/first-turn.ts`

- `export const FIRST_TURN_LINE = "This is the guest's first message in this conversation. Begin your reply with the AI disclosure described in your instructions.";` (verbatim from the issue, and not exported unless a test or the executor needs it. Export it only if the tests import it, so knip stays clean.)
- `export function buildFirstTurnLine(hasAssistantHistory: boolean): string | null`: returns `FIRST_TURN_LINE` when false, `null` when true.
- `export function hasAssistantMessage(messages: ModelMessage[]): boolean`: `messages.some((m) => m.role === "assistant")`. Used by the eval executor. If `memory.ts` can reuse it cleanly over rows it should, but rows are `MessageRow`, not `ModelMessage`, so the memory.ts check stays a one-line `rows.some(...)`.
- One short doc comment, same shape as `buildTodayLine`'s: this is the system-context line run-agent-turn.ts appends after the Braintrust prompt. The prompt owns the disclosure wording and this line only says when. Absence on later turns is the signal, so never add a "not first" line.
- Do not put the disclosure sentence itself in code.

### 3. Unit tests: `tests/agent/first-turn.test.ts`

- `buildFirstTurnLine(false)` returns exactly the issue's line.
- `buildFirstTurnLine(true)` returns `null`.
- `hasAssistantMessage([])` is false. For a list of only user messages it is false. For a list containing a plain-text assistant message it is true. For a list containing an assistant message whose content is a `tool-call` part array (the shape replayed from `turn_messages`) it is true.

### 4. `memory.ts`: expose `hasAssistantHistory`

- Add `hasAssistantHistory: boolean` to `AgentMemory`, with a short comment. It is computed over every fetched row of this conversation, before watermark filtering and trimming, so folded or trimmed replies still count, and it ignores `memoryMessage`, which is cross-conversation memory. This is a real landmine (the `memoryMessage` role trap), so the comment is warranted. State it once, here.
- In `loadMemoryState`, compute `const hasAssistantHistory = rows.some((r) => r.role === "assistant");` on the raw `rows` and add it to the return object. `foldMemory` also calls `loadMemoryState` and just ignores the new field.
- In `loadMemory`, pass `hasAssistantHistory` through in the returned `AgentMemory`.
- No new query and no change to `loadRecentMessages`.

### 5. Extend `tests/agent/memory.test.ts`

Use the existing mocks for `loadRecentMessages`/`getGuestMemory`/`loadGuestMemoryFolds`:

- No rows except the incoming user row gives `hasAssistantHistory === false`.
- Only user rows (guest double-texted before any reply) gives `false`.
- A prior assistant row with `turn_messages` (tool call + result replayed) gives `true`.
- A prior assistant row that sits **before the watermark** (already folded, absent from `historyMessages`) still gives `true`. Assert both that `historyMessages` has no assistant message and that `hasAssistantHistory` is true. This is the case a `historyMessages`-based check would get wrong.
- No rows but `preferences_summary` and a recent fold present (wiped conversation, returning guest): `memoryMessage` is non-null (`role: "assistant"`) and `hasAssistantHistory` is still `false`.
- Update existing `loadMemory` `toEqual` assertions, if any compare the whole result object, to include the new field.

### 6. Update `loadMemory` mocks elsewhere

- `tests/agent/run-guest-turn.test.ts` and `tests/agent/run-agent-turn.test.ts`: every `loadMemoryMock.mockResolvedValue({...})` gains `hasAssistantHistory`. Set it to match each fixture's history: `true` when the fixture history already contains an assistant message, `false` for single-user-message fixtures. Then check that the existing `system` assertions still hold. Any existing test with a first-turn fixture whose `system` assertion is an exact string needs the line added, or the fixture set to `hasAssistantHistory: true` if that test is not about the first turn.

### 7. Wire the line in `run-agent-turn.ts`

- Destructure `hasAssistantHistory` alongside `historyMessages, memoryMessage` from the `load-memory` step result.
- Replace `const system = \`${promptText}\n\n${buildTodayLine()}\`;`with a join of`[promptText, buildTodayLine(), buildFirstTurnLine(hasAssistantHistory)]`filtered for non-null, joined by`"\n\n"`. Keep it outside the step (the existing comment covers why). Extend that comment by at most one clause if needed, and don't re-explain.
- Do not touch `messages`, `historyLength` or the token budget.

### 8. Extend `tests/agent/run-agent-turn.test.ts`

- **First turn:** `loadMemory` returns one user message and `hasAssistantHistory: false`. Assert the model call's `system` ends with `\n\n` + the today line + `\n\n` + the exact first-turn line, and that `call.messages` equals the history unchanged (the line did not enter the budgeted history).
- **Later turn:** `hasAssistantHistory: true`. Assert `system` does not contain `"first message in this conversation"`.
- **Returning guest, wiped conversation:** `memoryMessage` non-null and `hasAssistantHistory: false`. The line is present, which proves `memoryMessage`'s assistant role does not suppress it.
- **Every round:** with a tool-call round followed by a final reply, assert every `runModel` call in the turn receives the line, not just round 1, since the disclosure is written in the final round.

### 9. Evals: types and executor

- `evals/types.ts`:
  - Add `firstTurn?: boolean` to `EvalInput`, with a comment saying it overrides detection for rows whose `messages` already include this turn's own tool-call/result (which contain an assistant message but are still the first turn).
  - Add `aiDisclosure?: "present" | "absent"` to `ExpectedShape` (optional, so every existing row is untouched).
- `evals/executors.ts` `singleTurnWithMocks`:
  - `const messages = evalMessages(input);`
  - `const firstTurn = input.firstTurn ?? !hasAssistantMessage(messages);`
  - Build `system` as the compiled prompt, `buildTodayLine(input.today)`, and `buildFirstTurnLine(!firstTurn)` unless `process.env.GCA_EVAL_DISABLE_FIRST_TURN_LINE === "1"`, filtered and joined exactly as production does. Update the "Same today line runAgentTurn appends" comment to cover both lines.
  - The kill switch gets a one-line comment in the style of `GCA_EVAL_DISABLE_TURN_REPLAY`'s.
  - Consequence to accept: existing single-user-message golden rows now get the line too, as they would in production. That is correct, and the Tool Call Match gate (≥80%) must still pass (checked in step 13).

### 10. Evals: the "AI Disclosure" scorer

- In `evals/evaluators.ts`, add `export function aiDisclosure({ output, expected }): Score`:
  - `expected?.aiDisclosure` undefined → `{ name: "AI Disclosure", score: null }` (skipped, no effect on other rows).
  - Opening = the reply's first sentence (split on `/(?<=[.!?])\s+/`). If that sentence is a bare greeting shorter than 20 characters ("Hi!", "Hello there!"), extend it with the next sentence, repeating until it is at least 20 characters long.
  - `identifies = /\bAI\b/i.test(opening)`.
  - `"present"` → score `identifies ? 1 : 0`. `"absent"` → score `identifies ? 0 : 1`, but for `"absent"`, test the **whole** reply, not just the opening, so a repeated introduction anywhere fails.
  - Put the `rationale` (opening checked, expectation) in metadata, matching `toolCallMatch`'s metadata style.
  - If a tone LLM judge existed offline it would be reused. None exists offline (`brand-alignment.scorer.ts` is an online Braintrust function), so use the deterministic regex the issue offers.
- Register it in `golden-dataset.eval.ts`: `scores: [toolCallMatch, aiDisclosure]`. Update the header comment's scorer mention in one clause.
- `scripts/ci-gate-evals.ts`: print "AI Disclosure" as **informational** (the same treatment as the prompt-injection Tool Call Match), not a gate. Add one line to the header comment explaining why: two rows × 3 trials is too small a sample to gate a merge on, and the row results are verified in the PR instead.

### 11. Unit tests for the scorer: extend `tests/evals/evaluators.test.ts`

- No expectation → `score: null`.
- `"present"` + `"Hi! I'm Issebya's AI concierge. Both rooms are free..."` → 1 (the greeting-extension rule).
- `"present"` + `"Both rooms are free October 6-8. Here's a quick comparison..."` (the prod reply) → 0.
- `"present"` + `"Hello, I'm an ai assistant for Issebya Homes."` → 1 (case-insensitive).
- `"present"` + a word containing "ai" such as `"I'd be glad to help with availability."` → 0 (word boundary).
- `"absent"` + `"Room 1 is €95 a night."` → 1. `"absent"` + `"As an AI concierge, I can tell you it's €95."` → 0.

### 12. Golden rows: `scripts/push-ai-disclosure-rows.ts`

- Copy the structure of `push-date-resolution-rows.ts`: header comment (what, why, the 2026-09-23 prod incident, the run command), `initDataset`, explicit-id upsert, a `storedRow` helper (copy the small helper locally; don't refactor the other script).
- Pin `today: "2026-09-23"` on both rows and use `contextBlock: "No prior guest information available."`.
- **`ai-disclosure-cold-start-01`** (issue eval (a)). The single-round harness only sees one model round, and a cold "do you have a room" usually yields a `check_availability` call with empty text. So the row supplies the in-progress first turn up to the final reply round:
  - `messages`: user `"Hi, do you have a room free 6-8 October?"`; assistant `tool-call` `check_availability` `{ checkIn: "2026-10-06", checkOut: "2026-10-08" }` (match the real tool's arg names in `src/agent/tools/availability.ts`); tool `tool-result` saying both rooms are available.
  - `firstTurn: true`, because the in-turn tool call is an assistant message but this is still the first turn.
  - `expected: { toolCall: null, expectedAlternative: "text-only", aiDisclosure: "present" }`.
- **`ai-disclosure-second-turn-01`** (issue eval (b)):
  - `rows`: user row `"Hi, do you have a room free 6-8 October?"`; assistant row whose `content` opens with an AI self-introduction and gives availability, and whose `turn_messages` carry the `check_availability` **and** `get_pricing` call/result pairs for 2026-10-06 to 2026-10-08. The price is then already in replayed history, so the model can answer in text. Last comes the user row `"How much is it?"`.
  - No `firstTurn` (detection from the replayed assistant row must yield "not first").
  - `expected: { toolCall: null, expectedAlternative: "text-only", aiDisclosure: "absent" }`.
- Run it once: `yarn workspace guest-communication-agent tsx --env-file=.env.development scripts/push-ai-disclosure-rows.ts`.

### 13. Run the evals: positive and negative

- With the line: `yarn workspace guest-communication-agent tsx --env-file=.env.development evals/golden-dataset.eval.ts`. Record the "AI Disclosure" pass count for each of the two rows across its 3 trials, plus the overall Tool Call Match, which must stay ≥ 0.80.
- Without the line: `GCA_EVAL_DISABLE_FIRST_TURN_LINE=1 yarn workspace guest-communication-agent tsx --env-file=.env.development evals/golden-dataset.eval.ts`. Expect `ai-disclosure-cold-start-01` to fail on at least 1 of 3 trials.
- Write both pass counts (e.g. "cold start 3/3 with, 1/3 without; second turn 3/3 with, 3/3 without") into the PR description. If the negative run passes 3/3, say so plainly. Do not tune the row until it fails.
- These runs cost real tokens and need `BRAINTRUST_API_KEY`/`OPENROUTER_API_KEY`/`BRAINTRUST_PROJECT_ID` in `.env.development`.

### 14. Docs

- `ENGINEERING.md` section 7: one bullet saying the golden set also carries `ai-disclosure-*` rows, scored by the deterministic "AI Disclosure" scorer (informational in the CI gate), and that `scripts/push-ai-disclosure-rows.ts` upserts them. In the section describing the per-turn system context (near the today line, if described), add one sentence: a first-turn line is appended when the conversation has no prior assistant row.
- No `AGENTS.md` change (no new behavioural rule beyond what the code comment states).

### 15. Validate

- Run every command in `Validation Commands`.

## Testing Strategy

### Unit Tests

- `tests/agent/first-turn.test.ts`: pure builder and detector.
- `tests/agent/memory.test.ts`: `hasAssistantHistory` from raw rows, including the folded-row and wiped-conversation cases.
- `tests/agent/run-agent-turn.test.ts`: the line reaches `system` on the first turn on every round, is absent on later turns, and leaves `messages` untouched.
- `tests/evals/evaluators.test.ts`: the `aiDisclosure` scorer's opening extraction, word boundary, skip behaviour and absent/present logic.

This app's tests live under `tests/**/*.test.ts` (vitest, node), not `*.unit.test.ts`. Follow the app's existing convention.

### Test Coverage

- `tests/agent/first-turn.test.ts` (unit, node): catches the line text drifting from the contract, or being returned when an assistant message (including a replayed tool-call one) is present.
- `tests/agent/memory.test.ts` (unit, node): catches `hasAssistantHistory` being derived from trimmed/watermarked `historyMessages` or from `memoryMessage` instead of raw rows. The folded-row and wiped-conversation cases fail under either wrong derivation.
- `tests/agent/run-agent-turn.test.ts` (unit, node): catches the line not reaching the model, appearing on later turns, entering `messages` (the history budget), or missing from the final round where the disclosure is actually written. All fail without this change.
- `tests/evals/evaluators.test.ts` (unit, node): catches a scorer that false-positives on words like "availability" or false-negatives on a leading "Hi!".
- The golden rows (Braintrust offline eval, not a vitest layer) prove the model actually acts on the line. The negative run with `GCA_EVAL_DISABLE_FIRST_TURN_LINE=1` demonstrates the need.
- No browser coverage: this change is confined to `apps/guest-communication-agent`, a webhook service with no browser surface. No Playwright spec or `e2e/*.md` journey applies.

### Edge Cases

- Guest double-texts before the first reply (two user rows, no assistant): both turns see `hasAssistantHistory: false` and both may introduce. This is acceptable and the unit test pins it as "still first".
- A turn suspended on `missing_info` and resumed: `hasAssistantHistory` comes from the memoized `load-memory` step, so it stays consistent across replay.
- Returning guest whose conversation was wiped but `guest_memory`/folds survive: the line is still appended (`memoryMessage` ignored).
- Conversation longer than the token budget, or with folded rows: raw rows still contain assistant replies, so no false "first".
- Conversation beyond the 150-row fetch window: the window always includes recent assistant rows unless a guest sent 150 unanswered messages. That is a negligible case, noted rather than handled.
- Owner-sent replies recorded as assistant rows count as prior assistant history. That is correct, because the guest has already been answered.

## Acceptance Criteria

- On a conversation with no prior assistant row, every model call in the turn receives `system` = prompt + today line + `This is the guest's first message in this conversation. Begin your reply with the AI disclosure described in your instructions.`
- On any turn where the conversation has a prior assistant row (including folded or trimmed ones), nothing is appended. There is no "not first" line.
- No new DB query. `hasAssistantHistory` comes from rows `loadMemoryState` already fetches.
- The line is in `system`, not `messages`, and does not count against `trimToTokenBudget`.
- No disclosure wording in code, and the Braintrust prompt stays unpinned and unedited.
- Unit tests above pass and fail without the change.
- Golden rows `ai-disclosure-cold-start-01` and `ai-disclosure-second-turn-01` pass with the line. The negative run's pass counts with and without the line are stated in the PR.
- Golden Tool Call Match ≥ 0.80 and prompt-injection gates unchanged, so the CI eval gate is green.
- After deploy (owner-run): the test number's conversation is wiped and one message sent, and the reply opens with the disclosure. A second message is sent and the reply does not repeat it. Both replies are quoted in the PR or issue.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .`: formatting matches the repo config, so the commit hook won't reject it
- `yarn turbo run lint --filter=./apps/guest-communication-agent`: lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent`: types are sound (including updated `loadMemory` mocks)
- `yarn knip`: no unused files, exports or dependencies introduced (e.g. `FIRST_TURN_LINE` exported only if imported)
- `yarn turbo run test --filter=./apps/guest-communication-agent`: unit tests pass, including the new first-turn, memory, run-agent-turn and scorer tests
- `yarn turbo run build --filter=./apps/guest-communication-agent`: production build succeeds
- `yarn workspace guest-communication-agent tsx --env-file=.env.development scripts/push-ai-disclosure-rows.ts`: upserts the two golden rows (needs Braintrust key)
- `yarn workspace guest-communication-agent tsx --env-file=.env.development scripts/ci-gate-evals.ts`: CI eval gate green locally, with the AI Disclosure average printed (needs Braintrust + OpenRouter keys)
- `GCA_EVAL_DISABLE_FIRST_TURN_LINE=1 yarn workspace guest-communication-agent tsx --env-file=.env.development evals/golden-dataset.eval.ts`: negative run. Record the cold-start row's pass count (expected < 3/3). This run is expected to show a failing row; it demonstrates the fix and is not a regression check.

## Notes

- **Why raw rows, not `historyMessages`:** the issue's suggested `firstTurnLine(history)` over the loaded messages gives the wrong answer in two real cases. `memoryMessage` is `role: "assistant"` (so a returning guest's wiped conversation would never get the disclosure, which is exactly the prod repro if `guest_memory` survived the wipe). And folded or trimmed replies disappear from `historyMessages`. Computing over the rows `loadMemoryState` already fetched matches the issue's primary definition ("no prior assistant row in `whatsapp_messages`") with no new query. The issue's parenthetical "and `guest_memory` has no summary" is deliberately **not** used: `guest_memory` is per phone and survives conversation wipes, so checking it would suppress the disclosure on a genuinely new conversation.
- **Why the scorer is informational in the CI gate:** 2 rows × 3 trials = 6 samples. That is too few to block merges on without flakes. The row results and the negative-run pass counts are verified in the PR instead. Promoting it to a gate once more disclosure rows exist is a follow-up.
- Braintrust excludes `null` scores from a scorer's average. Confirm this in the first eval run's summary (the "AI Disclosure" average should reflect only the two rows). If it doesn't, restrict the ci-gate print to those rows' results.
- The existing single-user-message golden rows now receive the first-turn line, as they would in production. If Tool Call Match drops on them (e.g. the model answers with an introduction instead of calling a tool), treat that as a real finding: report it, don't mask it.
- No new dependencies.
- Out of scope: the disclosure sentence (Braintrust, owner-edited), reply-language selection, and the reply-loss bug on invalid trace ids.
