# Each turn's tool calls and results are stored and replayed as history

**ADW ID:** 4f43c209
**Date:** 2026-09-22
**Specification:** `specs/issue-113-adw-4f43c209-sdlc_planner-persist-turn-messages-for-replay.md`

## Overview

On 2026-09-22 a guest said "ASAP", the agent's `run_code` found Room 1 free from
2026-10-06 to 2026-10-08, and the reply offered "October 6 to October 8". When
the guest said "Yes", the model only had that prose to work from. It guessed
2025, `send_booking_link` refused the past date (the #87 guard), and the agent
re-offered the same dates twice. Only the reply text of each turn was saved, so
every fact a tool found was gone one turn later.

Each guest turn now stores its own AI SDK messages (tool calls, tool results,
final reply) on its assistant row, and the next turns replay them word for word.
The model also gets today's date in its system context on every call.

## What Was Built

- A nullable `turn_messages jsonb` column on `whatsapp_messages`, holding
  `{ schema_version: 1, messages }`, plus a partial unique index that makes the
  assistant-row write idempotent per trace.
- `src/agent/turn-messages.ts`: the stored shape, the 2,000-character cap on
  each tool result, and `finalizeTurnMessages`, which makes every stored array
  self-contained.
- Turn-grouped history in `memory.ts` (`buildHistoryMessages`): the last 3 turns
  replay their stored messages verbatim, older turns replay as text, and anything
  older is covered by the existing folds.
- Whole-turn trimming in `context.ts`, with the budget raised from 1600/800 to
  8000/6000 tokens.
- URL redaction that also walks replayed tool results.
- A today line (`Today's date is Tuesday, 2026-09-22 (UTC).`) appended after the
  Braintrust `gca-system` prompt.
- A `past_date` refusal that tells the model to re-read the dates from its
  earlier tool result and call the tool again.
- Evals that build history through production's `buildHistoryMessages`, a new
  golden row `date-resolution-replay-01`, an updated `date-resolution-year-01`,
  and an eval-only switch that turns replay off.

## Technical Implementation

### Files Modified

- `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql`:
  the column and `whatsapp_messages_assistant_trace_id_key` (unique on
  `trace_id` where `role = 'assistant' and trace_id is not null`).
- `src/agent/turn-messages.ts` (new): `StoredTurnMessages`,
  `TURN_MESSAGES_SCHEMA_VERSION`, `truncateToolOutputs`, `finalizeTurnMessages`.
- `src/agent/run-agent-turn.ts`: returns `turnMessages` (everything after the
  loaded history) and appends `buildTodayLine()` to the system prompt.
- `src/agent/run-guest-turn.ts`: finalizes `turnMessages` and passes them to
  `recordMessage` in the `record-reply` step.
- `src/lib/conversations.ts`: `recordMessage` takes `{ turnMessages }`. On a
  unique violation for an assistant row with a trace id, it looks up and returns
  the existing row's id.
- `src/lib/db.ts`: `MessageRow.turn_messages`, selected by `loadRecentMessages`.
  Any unknown `schema_version` parses to null.
- `src/agent/memory.ts`: `groupRowsByTurn`, `buildHistoryMessages` (exported),
  tool-result redaction, and the watermark now advances on whole dropped groups.
- `src/agent/context.ts`: `trimToTokenBudget` takes and returns turn groups.
- `src/agent/tools/current-date.ts`: `buildTodayLine(isoDate?)`.
- `src/agent/tools/booking.ts`: new `past_date` refusal text.
- `evals/executors.ts`, `evals/types.ts`, `evals/evaluators.ts`: `EvalInput`
  takes either `messages` or stored `rows`, plus an optional pinned `today`.
  `evalMessages` builds the history, and the security judge sees the same
  history.
- `scripts/push-date-resolution-rows.ts`: golden rows (a) and (b).
- `ENGINEERING.md`: memory section updated for turn replay, the new budget and
  the today line.

### Key Changes

- **Stored arrays are self-contained.** `finalizeTurnMessages` keeps only
  assistant text/tool-call parts and tool messages, caps tool outputs, and
  always ends in assistant reply text (the step-cap path ends on a tool message,
  so the reply is appended). Replay interleaves these arrays with other rows, and
  a dangling tool-call gets a 400 from the provider.
- **Truncation.** A tool output over 2,000 characters becomes a `text` output
  holding the first 2,000 characters plus
  `…[truncated N of M chars; call the tool again for the full output]`.
  Tool-call inputs are never cut.
- **Trimming never splits a turn.** `trimToTokenBudget` drops whole groups from
  the front and never drops the last one. The fold watermark therefore always
  lands on a turn boundary.
- **Redaction per group.** Every message in a group that touches one of the last
  `RECENT_MESSAGES_KEPT_UNREDACTED` rows stays unredacted. Older groups have URLs
  redacted in text and in tool-result outputs, but not in tool-call inputs.
- **Folds are unchanged.** The summariser still maps rows through the text-only
  `toModelMessage`, so no tool JSON ever reaches `guest_memory`.

## How to Use

This change works automatically. There is nothing to call.

1. A guest turn runs as before. Its assistant row now carries `turn_messages`.
2. On the guest's next messages, the model's input (`gen_ai.input.messages` in
   Braintrust) shows the earlier `tool-call`/`tool-result` pairs for the last 3
   turns.
3. To inspect what was stored, query
   `select content, turn_messages from whatsapp_messages where role = 'assistant' order by created_at desc`.

## Configuration

- No new environment variables in the app.
- `GCA_EVAL_DISABLE_TURN_REPLAY=1` (evals only) replays stored rows as text
  only, the old behaviour, to prove a golden row catches the regression.
- Tunables live in code: `VERBATIM_TURNS = 3` (`memory.ts`),
  `TOOL_OUTPUT_MAX_CHARS = 2000` (`turn-messages.ts`),
  `MAX_CONTEXT_TOKENS = 8000` / `KEEP_CONTEXT_TOKENS = 6000` (`context.ts`).
- The migration must be applied (locally with `supabase migration up`, never a
  reset). The unique index fails to build if duplicate assistant rows per
  `trace_id` already exist.

## Testing

- Unit tests: `tests/agent/turn-messages.test.ts` (new), plus updated
  `memory.test.ts`, `context.test.ts`, `run-agent-turn.test.ts`,
  `run-guest-turn.test.ts`, `tests/lib/conversations.test.ts`,
  `tests/lib/db.test.ts`, `tools/booking.test.ts`. Run with `yarn test` in the
  app.
- Golden rows: push with
  `yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts`,
  then run `scripts/ci-gate-evals.ts`. Row (a) should call
  `send_booking_link(room1, 2026-10-06, 2026-10-08, …)`.
- Negative check: prefix `evals/golden-dataset.eval.ts` with
  `GCA_EVAL_DISABLE_TURN_REPLAY=1`. Row (a) should score 0 on Tool Call Match.
  The row's offer prose deliberately leaves out the dates, so the dates only
  exist in the replayed `run_code` result.

## Notes

- Rows written before deploy, user rows and admin-resend rows have
  `turn_messages = null` and replay as text. The fix applies from the first turn
  recorded after deploy. There is no backfill.
- `recordMessage` uses select-after-conflict rather than an upsert, because
  PostgREST's `onConflict` can't target a partial index.
- `turnMessages` is derived from memoized step outputs and is never returned
  from a step, so Inngest step-state size is unchanged.
- Earlier turns' tool outputs now appear in Braintrust traces. The existing
  `setMaskingFunction` todo still applies.
- Out of scope: a pending-offer side-state, the repeated-reply guard (#114),
  tool facts inside folds, property timezone, and `find_first_available` (#85).
