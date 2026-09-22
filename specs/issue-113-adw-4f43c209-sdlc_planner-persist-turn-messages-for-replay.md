# Bug: GCA forgets the tool calls and results it made in earlier turns

## Metadata

issue_number: `113`
adw_id: `4f43c209`
issue_json: `{"number":113,"title":"GCA: persist each turn's tool calls and results and replay them as history — the agent loses the facts it found one turn later", ...}` (full body: GitHub issue #113, including the 2026-09-22 Addendum, which takes precedence where it differs)

## Bug Description

Production, 2026-09-22 21:48–21:57, the owner's test conversation on WhatsApp:

| turn | guest                             | agent                                         | what the trace shows                                                                                                                                                                     |
| ---- | --------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | "ASAP"                            | "Room 1 is open from October 6 to October 8." | `run_code` searched with **2026** dates and found 2026-10-06 → 2026-10-08                                                                                                                |
| 4    | "Yes"                             | the same offer again                          | `send_booking_link` called with **`2025-10-06`**. `verify-send_booking_link-availability` refused it (`past_date`), so there was no owner nudge. The model searched again and re-offered |
| 5    | "Yes, I've already answered this" | the same offer, now "…, 2026"                 | same path                                                                                                                                                                                |

**Expected:** at turn 4 ("Yes"), the model calls `send_booking_link(room1, 2026-10-06, 2026-10-08)` using the exact dates its own `run_code` call returned at turn 3. The owner gets a Telegram nudge for 2026 dates.

**Actual:** at turn 4 the model only sees the prose "Room 1 is open from October 6 to October 8" followed by "Yes". It has to work out the ISO dates from its own sentence, guesses the wrong year (2025), gets refused, and loops. The same loss affects anything a tool found in an earlier turn: a quoted price, a knowledge-base answer, an availability result.

## Problem Statement

The agent's next turn does not start from what it actually did. Within one turn, `runAgentTurn` keeps the full `ModelMessage[]`, including assistant `tool-call` parts and `role: "tool"` `tool-result` messages. At the end of the turn only the reply text is saved (`recordMessage(conversationId, "assistant", replyText)`, which fills `whatsapp_messages.role/content` and nothing else). On the next turn `memory.ts`'s `toModelMessage(row)` rebuilds history as plain `{ role, content: text }`. The tool facts are gone. On top of that, `KEEP_CONTEXT_TOKENS = 800` (`context.ts`) trims the replayed text history to a handful of messages. That limit was never chosen with tool messages in mind.

## Solution Statement

Save each turn's actual SDK messages with the assistant reply and replay them word for word next time. Five parts:

1. **Persist.** Add a nullable `turn_messages jsonb` column to `whatsapp_messages`, holding `{ schema_version: 1, messages: ModelMessage[] }`. `messages` is this turn's tail in the installed AI SDK v6 shape:
   - assistant messages with `tool-call` parts (`input`, not `args`)
   - `role: "tool"` messages with `tool-result` parts
   - always ending in the final `{ role: "assistant", content: replyText }`. This also covers the step-cap fallback, where the loop ends on a tool message.

   Before storing, cap each `tool-result` output at 2,000 characters. An oversized output becomes `{ type: "text", value: "<first 2000 chars>…[truncated N of M chars; call the tool again for the full output]" }`. Tool-call `input` (args) is never truncated. The write is idempotent under Inngest retries: a partial unique index on `(trace_id) where role = 'assistant'`, plus select-after-conflict.

2. **Replay in three tiers, grouped by turn.** History is grouped into turns (`[user row, ...its assistant rows]`):
   - The last 3 turns replay each assistant row's `turn_messages.messages` verbatim.
   - Older unfolded turns replay text-only (`row.content`).
   - Anything older is already covered by the existing `guest_memory` fold.

   Trimming drops whole turn groups from the front and never splits one, so tool-call/tool-result pairs always stay together. The budget becomes `MAX_CONTEXT_TOKENS = 8000` / `KEEP_CONTEXT_TOKENS = 6000`, with the reasoning written in the code comment.

   Redaction (`redactUrls`) now walks `tool-result` outputs too. The unredacted window covers every message in any turn group that touches one of the last `RECENT_MESSAGES_KEPT_UNREDACTED` rows.

   The summariser keeps a text-only row mapper, so folds are unchanged.

3. **Today's date in context.** After the Braintrust `gca-system` prompt text, code appends one system line built from `computeCurrentDate()`. No other prompt edits.

4. **Better `past_date` refusal.** `describeBookingRefusal("past_date")` names the bad date and today, then tells the model to re-read the dates from its earlier tool result and call the tool again. Every #87 guard stays as it is.

5. **Evals use the same code path.** Export the history builder from `memory.ts` and use it in `evals/executors.ts`. Add golden row (a), the 5-turn transcript with `turn_messages`, and update row (b), the cold-start "October 11–13 room 1". Add an eval-only switch that turns off `turn_messages` replay, to prove row (a) catches the regression.

Nothing new is stored as side-state and nothing is re-executed on replay. A stored "not approved" `send_booking_link` result is replayed exactly as the model saw it.

## Steps to Reproduce

1. Deterministic, no network (this becomes the failing unit test). Call today's `loadMemory` with mocked `loadRecentMessages` returning:
   - user "I'd like to book room 1 asap"
   - assistant "Which dates?"
   - user "ASAP"
   - assistant "Room 1 is open from October 6 to October 8."
   - user "Yes"

   `historyMessages` contains no `tool-call`/`tool-result` part and no `2026-10-06` string. The facts the model needs at turn 4 are simply not in its input.

2. Code path. `run-guest-turn.ts:102` calls `recordMessage(conversationId, "assistant", replyText, traceAnchor.traceId)`, which drops `result.messages`. `memory.ts` `toModelMessage` rebuilds `{ role, content }` only.
3. Model behaviour (eval). Run the golden dataset with row (a) (Step 13) and replay turned off (`GCA_EVAL_DISABLE_TURN_REPLAY=1`). The model does not produce `send_booking_link(room1, 2026-10-06, 2026-10-08)`.
4. Production evidence: the 2026-09-22 21:48–21:57 Braintrust traces cited in the issue. Model-1's input at turn 4 has no tool messages.

## Root Cause Analysis

- **The storage format loses data.** `whatsapp_messages` only has `role` and `content`, and `recordMessage` only writes `replyText`. `runAgentTurn` returns the whole `messages` array (history plus this turn's tool rounds plus the final text), but `runGuestTurn` only reads `messages.at(-1)`.
- **Replay is text-only by design.** `toModelMessage(row, redact)` returns `{ role, content: string }`. There is nowhere for tool parts to come from.
- **Trimming works per message.** `trimToTokenBudget` calls `shift()` one message at a time. That was harmless with text-only messages. With tool messages it could orphan a `tool-call` from its `tool-result`, and providers reject that with a 400. So any fix must trim whole turns.
- **The budget is too small.** At 800/1600 tokens only a few messages survive. A single `run_code` result would push everything else out, or be cut itself.
- **Why the #87 guard exposed it rather than caused it.** Before #87, the same turn produced a 2025 link (the 2026-09-21 incident). The guard turned a wrong link into a refusal. The refusal text gives no recovery hint, and the model has no record of its earlier result to recover from. So it searches again.
- **Why the model guessed 2025.** Nothing in the system context states today's date. It only knows it if it calls `get_current_date` in that turn, which it skips when it thinks it "already knows" the dates.

## Relevant Files

Use these files to fix the bug:

- `README.md`, `AGENTS.md`: repo conventions (yarn only, conventional commits, never reset the shared Supabase, never start the webhook app's dev server).
- `docs/conditional-docs.md`: index. It points to the two docs below.
- `apps/guest-communication-agent/AGENTS.md`: GCA conventions. `steppedSpan` rather than hand-nested step/span code, named functions inside span wrappers, and comment rules (landmines only, stated once, no changelog-style narrative).
- `apps/guest-communication-agent/ENGINEERING.md`: agent loop, memory tiers, Inngest suspends. Its "Per-turn trimming" section (line ~70, "Budget: 1600 tokens in, trimmed down to 800") must be updated.
- `apps/guest-communication-agent/app_docs/feature-d7d0c40c-reject-past-dates-booking.md`: the #87 guard. The refusal shape must not trip `detectToolSoftFailure`; only the text changes.
- `apps/guest-communication-agent/src/agent/run-agent-turn.ts`: the loop. It builds `messages`, calls `toolResultMessage` (output `{type:"json"}`), appends `result.response.messages`, and returns `RunAgentTurnResult`. It must also return this turn's tail and append the today line to `system`.
- `apps/guest-communication-agent/src/agent/run-guest-turn.ts`: `record-reply` step. It must pass the finalized, truncated `turnMessages` to `recordMessage`.
- `apps/guest-communication-agent/src/lib/conversations.ts`: `recordMessage`. Gains `{ turnMessages }` and idempotent insert (select-after-conflict).
- `apps/guest-communication-agent/src/lib/db.ts`: `MessageRow` and `loadRecentMessages`. They must select and return `turn_messages`.
- `apps/guest-communication-agent/src/agent/memory.ts`: `toModelMessage`, `redactUrls`, `RECENT_MESSAGES_KEPT_UNREDACTED`, `loadMemoryState` (shared by `loadMemory`/`foldMemory`), `foldMemory`'s text-only summariser input. This is where turn grouping, the three tiers, group-level redaction and the exported history builder go.
- `apps/guest-communication-agent/src/agent/context.ts`: `MAX_CONTEXT_TOKENS`/`KEEP_CONTEXT_TOKENS`/`estimateTokens`/`trimToTokenBudget`. New budget and whole-group trimming.
- `apps/guest-communication-agent/src/agent/run-model.ts`: sets `gen_ai.input.messages` from `messages`. That attribute already carries whatever history is passed in, so replayed tool messages and truncation markers show up in Braintrust with no change. Read only.
- `apps/guest-communication-agent/src/agent/tools/current-date.ts`: `computeCurrentDate`. Add the today-line builder here, next to the single source of "now".
- `apps/guest-communication-agent/src/agent/tools/booking.ts`: `describeBookingRefusal` `past_date` text.
- `apps/guest-communication-agent/src/agent/tools/stay-range.ts`: `StayRangeProblem`. Read only.
- `apps/guest-communication-agent/src/app/api/admin/pending-decisions/[id]/actions/resolve/route.ts`: another `recordMessage("assistant", …)` caller with no trace id. Must keep working unchanged (null `trace_id` never conflicts on the partial index).
- `apps/guest-communication-agent/src/app/api/webhook/whatsapp/route.ts`: records the user row. Unchanged.
- `apps/guest-communication-agent/evals/executors.ts`, `evals/types.ts`: the eval must build history through the exported `memory.ts` builder, apply the same today line, and honour the eval-only replay switch.
- `apps/guest-communication-agent/evals/golden-dataset.eval.ts`, `scripts/ci-gate-evals.ts`, `.github/workflows/eval-golden.yml`: the CI eval gate that must stay green.
- `apps/guest-communication-agent/scripts/push-date-resolution-rows.ts`: the pattern for PR-reviewed golden rows (idempotent upsert by `id`). Rows (a) and (b) go here.
- `apps/guest-communication-agent/tests/agent/context.test.ts`, `tests/agent/memory.test.ts`, `tests/agent/run-agent-turn.test.ts`, `tests/agent/run-guest-turn.test.ts`, `tests/lib/conversations.test.ts`, `tests/agent/tools/booking.test.ts`, `tests/api/admin/pending-decisions/[id]/actions/resolve/route.test.ts`: existing tests. Their fixtures depend on the 1600/800 budget, the `recordMessage` signature and the `past_date` text, so they need updating.
- `supabase/migrations/20260821080000_add_delivery_status_to_whatsapp_messages.sql`: style reference for a `whatsapp_messages` column migration.
- `knip.json`: GCA entry is `tests/**/*.test.ts` + `scripts/**/*.ts`. `evals/` is not in `project`, so any export used only by evals needs a test or script consumer too.

### New Files

- `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql`: the column plus the partial unique index.
- `apps/guest-communication-agent/src/agent/turn-messages.ts`: the stored shape (`StoredTurnMessages`, `TURN_MESSAGES_SCHEMA_VERSION = 1`), `TOOL_OUTPUT_MAX_CHARS = 2000`, `truncateToolOutputs`, and `finalizeTurnMessages(tail, replyText)`. Pure, no I/O, so it can be unit tested and imported by both `run-guest-turn.ts` and `memory.ts` without circular imports.
- `apps/guest-communication-agent/tests/agent/turn-messages.test.ts`: unit tests for the module above.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions and docs

- Read `apps/guest-communication-agent/AGENTS.md`, `ENGINEERING.md` (memory and Inngest sections), and `app_docs/feature-d7d0c40c-reject-past-dates-booking.md`.
- Confirm the installed `ai` version (`yarn why ai`; the issue says 6.0.230). Check the `ModelMessage` / `ToolResultPart` / `ToolCallPart` types in `node_modules/ai` / `@ai-sdk/provider-utils`: `input` on tool-call; `output: { type: "json" | "text" | …, value }` on tool-result.

### 2. Migration: `turn_messages` column plus idempotency index

- Create `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql`, in the same comment style as the delivery_status migration. State facts, not history:
  - `alter table public.whatsapp_messages add column turn_messages jsonb;` It is nullable. It is only set on `role = 'assistant'` rows written by a guest turn. Legacy rows and admin-resend rows stay null and replay as text.
  - `create unique index whatsapp_messages_assistant_trace_id_key on public.whatsapp_messages (trace_id) where role = 'assistant' and trace_id is not null;` This makes the `record-reply` write idempotent when Inngest retries a step whose insert succeeded but whose response was lost.
- Before relying on the index, check for existing duplicates. Run this against the local DB, read only (never reset it):

  ```sql
  select trace_id, count(*) from whatsapp_messages where role='assistant' and trace_id is not null group by 1 having count(*)>1;
  ```

  The same check must pass against prod before merge (see Notes). If duplicates exist, stop and report. Do not add a blind dedupe `delete`: `guest_memory.summarized_through_message_id` and `guest_memory_folds` reference message ids.

- Apply it to the shared local DB without a reset: `supabase migration up` (or the repo's documented equivalent). Never run `supabase start` or `supabase db reset`.
- There is no generated Supabase `Database` type in this app (the admin client is untyped), so there are no types to regenerate. `MessageRow` in `db.ts` is the hand-written type and is updated in Step 4.

### 3. `turn-messages.ts`: stored shape, truncation, finalization

- `export const TURN_MESSAGES_SCHEMA_VERSION = 1;`
- `export interface StoredTurnMessages { schema_version: 1; messages: ModelMessage[] }`. The field name is `schema_version`, as the issue requires, because the SDK has renamed these fields before.
- `const TOOL_OUTPUT_MAX_CHARS = 2000;` Comment: this caps a single tool's result replayed from a previous turn. Args are the facts and are never truncated. The truncated form is `type: "text"` because a cut JSON string is invalid JSON.
- `truncateToolOutputs(messages)`:
  - For every `role: "tool"` part with `type: "tool-result"`, serialize the output value (`json` → `JSON.stringify(value)`, `text` → `value`).
  - If the length is over the cap, replace it with `{ type: "text", value: serialized.slice(0, 2000) + "…[truncated " + (M - 2000) + " of " + M + " chars; call the tool again for the full output]" }`.
  - Leave assistant `tool-call` parts (`input`) untouched.
- `finalizeTurnMessages(tail, replyText): StoredTurnMessages`:
  - Keep only the parts the issue lists: assistant `text` and `tool-call` parts, and `tool` messages. Drop assistant `reasoning` parts if the provider returned any. They are not facts the next turn needs, and they would eat the budget.
  - Apply `truncateToolOutputs`.
  - If the last message is not `{ role: "assistant", content: string }` (the step-cap path ends on a `tool` message), append `{ role: "assistant", content: replyText }`. This guarantees every stored array ends in assistant text and every tool-call in it has its result. State that invariant in one comment: each stored array must be self-contained, or the provider rejects the request with a 400.

### 4. `db.ts` and `conversations.ts`: read and write `turn_messages`

- `db.ts`:
  - Add `turn_messages: StoredTurnMessages | null` to `MessageRow`.
  - Add `turn_messages` to `loadRecentMessages`' `.select(...)` and mapping.
  - Treat a stored object whose `schema_version` is not `1` as `null` (text-only replay), so a future shape change degrades instead of sending malformed messages.
- `conversations.ts`, `recordMessage(conversationId, role, content, traceId?, options?: { turnMessages?: StoredTurnMessages })`:
  - Write `turn_messages` when it is supplied.
  - Idempotency: on insert error code `23505` when `role === "assistant"` and `traceId` is set, select `id` from `whatsapp_messages` where `trace_id = traceId` and `role = 'assistant'`, and return that id. PostgREST `upsert(onConflict)` cannot target a partial index, so this uses select-after-conflict, not `on conflict do nothing`.
  - Any other error still throws, as today.

### 5. `run-agent-turn.ts`: return this turn's tail and add today's date

- After `messages` is first built from `memoryMessage` + `historyMessages`, record `const historyLength = messages.length`.
- Add `turnMessages: ModelMessage[]` to `RunAgentTurnResult`, set to `messages.slice(historyLength)` on both return paths (final text, step cap). This is everything from this turn's first assistant message onward.
- Today line:
  - In `current-date.ts`, export `buildTodayLine(isoDate: string = computeCurrentDate().date): string`, returning e.g. `"Today's date is Tuesday, 2026-09-22 (UTC)."`. Derive the weekday from `isoDate` with the same `toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })` so evals can pass a fixed date.
  - In `runAgentTurn`, append it to the system text after the Braintrust prompt: `const system = \`${promptText}\n\n${buildTodayLine()}\``. It is computed outside the `load-system-prompt`step on purpose: a turn resumed after a`missing_info` suspension then gets the real current date on its later model calls. Earlier model calls stay memoized.
  - Keep the one-line comment short. Do not change the Braintrust prompt and do not pin its version.

### 6. `run-guest-turn.ts`: record `turn_messages` once, at `record-reply`

- After computing `replyText`, compute `const turnMessages = finalizeTurnMessages(result.turnMessages, replyText)`. Do this outside any step: it is deterministic over memoized step outputs.
- Pass it to `recordMessage(conversationId, "assistant", replyText, traceAnchor.traceId, { turnMessages })` inside the existing `record-reply` `steppedSpan`.
- No other step changes. A `missing_info`-suspended turn still records once when it finishes, because `runAgentTurn` returns only after the loop ends.

### 7. `context.ts`: new budget and whole-group trimming

- Replace `MAX_CONTEXT_TOKENS = 1600` / `KEEP_CONTEXT_TOKENS = 800` with `8000` / `6000`. The comment should justify the numbers by conversation shape:
  - ~10 turns with 1–2 tool rounds each and 2,000-char-capped results fit in 6000.
  - deepseek-v4-pro over OpenRouter has a 1M context at ~$0.88/M input, so under a cent per turn.
  - Keep the existing "KEEP must stay below MAX" landmine comment.
- Replace `trimToTokenBudget(messages)` with `trimToTokenBudget(groups: ModelMessage[][]): ModelMessage[][]`:
  - Same MAX/KEEP hysteresis.
  - Drops whole groups from the front, never a message from inside one.
  - Never drops the last group (the current turn's incoming user message).
  - `estimateTokens` is unchanged and is applied to the flattened groups.

### 8. `memory.ts`: turn grouping, three tiers, group redaction, exported builder

- Group `unfoldedRows` (oldest first) into turn groups:
  - A `user` row starts a new group.
  - `assistant` rows join the current group.
  - Leading assistant rows (possible right after the watermark) form their own group.
  - Interleaving from a suspended turn (user1, user2, assistant(run2), assistant(run1)) is safe, because each stored `turn_messages` array is self-contained (Step 3).
- Tiers: the last `VERBATIM_TURNS = 3` groups replay assistant rows as `row.turn_messages?.messages ?? [text message]`. Older groups replay text-only `toModelMessage(row)`. Name and comment the constant with its reason: Anthropic `clear_tool_uses` keeps 3 by default, and the AI SDK's `pruneMessages` uses `before-last-3-messages`.
- Redaction:
  - A group is unredacted if any of its rows is within the last `RECENT_MESSAGES_KEPT_UNREDACTED` rows. The existing landmine comment still holds; adjust it to say the window now applies per turn group.
  - Otherwise `redactUrls` is applied to string content, assistant `text` parts, and `tool-result` outputs: the `text` value, and every string inside a `json` value, walked recursively. `send_booking_link`'s result carries the URL.
  - Tool-call `input` is left alone. It holds no URLs and it is the facts.
- Export `buildHistoryMessages(rows: MessageRow[], options?: { replayTurnMessages?: boolean }): { groups: ModelMessage[][]; rowGroups: MessageRow[][] }` (or an equivalent shape that lets `loadMemoryState` map dropped groups back to rows). `replayTurnMessages` defaults to `true`. `false` forces text-only for every row and exists only for the eval regression switch; say so in one line.
- `loadMemoryState`:
  - Build the groups, call the group-level `trimToTokenBudget`, flatten the kept groups into `historyMessages`.
  - `newlyDroppedRows` = the rows of the dropped groups, in order. The watermark now always advances at a turn boundary.
  - Keep the "watermark filtering before trimming" landmine as is.
- `foldMemory` stays text-only. It keeps mapping `newlyDroppedRows` through `toModelMessage(row, true)` (which ignores `turn_messages`), so the summariser never receives tool JSON. Add one line naming this as the text-only summariser mapper.

### 9. `booking.ts`: `past_date` refusal text

- Change only the `past_date` case to:

  ```ts
  `Cannot build a booking link: check-in ${checkIn} is in the past (today is ${today}). Re-read the dates from your earlier tool result in this conversation and call the tool again with them.`;
  ```

- No computed suggestion, no date rewriting. Every other case and every #87 guard stays the same, including verify-before-gate in `requestSendBookingLinkApproval`.
- Update the expected strings in `tests/agent/tools/booking.test.ts` and `tests/api/admin/pending-decisions/[id]/actions/resolve/route.test.ts`.

### 10. Unit tests: `turn-messages.test.ts` (new)

- A tool-result over 2,000 chars becomes `type: "text"` with the exact `…[truncated N of M chars; call the tool again for the full output]` marker. A matching tool-call's large `input` is byte-for-byte unchanged.
- A result at or under 2,000 chars is left as-is (`type: "json"` preserved).
- A step-cap tail ending in a `tool` message gets `{ role: "assistant", content: replyText }` appended. A tail already ending in assistant text is not duplicated.
- Reasoning parts are dropped; tool-call and text parts are kept.
- The output carries `schema_version: 1`.

### 11. Unit tests: `context.test.ts` and `memory.test.ts`

- `context.test.ts`:
  - Rewrite the fixtures for 8000/6000.
  - New case: groups where the budget falls in the middle of a group. The whole oldest group is dropped, and no returned group is partial.
  - The last group is never dropped.
- `memory.test.ts`:
  - Rewrite the fixtures that relied on 1600/800.
  - **Regression case (fails before the fix).** Rows reproduce the 5-turn transcript. The turn-3 assistant row's `turn_messages` holds:
    - a `run_code` tool-call
    - a tool-result containing `2026-10-06`/`2026-10-08`
    - the text "Room 1 is open from October 6 to October 8."

    `loadMemory`'s `historyMessages` contain that tool-call part and tool-result part verbatim, in place of the row's plain text.

  - Three tiers: with 5 turns carrying `turn_messages`, only the last 3 replay tool parts. Older ones are text-only.
  - Redaction: a `send_booking_link` tool-result whose `json` value contains a URL is redacted to `[link]` when its group is outside the unredacted window, and kept when inside. The flag applies to every message in a group that touches the window.
  - `foldMemory` passes text-only transcript lines to the summariser (no `tool-call` JSON) even when dropped rows have `turn_messages`.
  - `buildHistoryMessages(rows, { replayTurnMessages: false })` returns text-only messages.
  - A row with an unknown `schema_version` replays as text.

### 12. Unit tests: loop, delivery, persistence

- `run-agent-turn.test.ts`:
  - `turnMessages` is exactly this turn's appended messages on the final-text path and on the step-cap path.
  - The `system` passed to `runModel` ends with the today line (fake timers / fixed `Date`).
- `run-guest-turn.test.ts`:
  - `recordMessage` is called once, from `record-reply`, with `{ turnMessages }` whose array ends in the reply text.
  - On a step-cap turn it ends in `FALLBACK_REPLY_TEXT`.
- `conversations.test.ts`:
  - `turn_messages` is included in the insert when supplied.
  - A `23505` conflict on an assistant row with a trace id returns the existing row's id (select-after-conflict).
  - Other errors still throw.

### 13. Evals: one history code path, golden rows (a)/(b), negative switch

- `evals/types.ts`: extend `EvalInput` with optional `rows?: MessageRow[]`, meaning prior turns as stored rows including `turn_messages`, with the newest guest message last. Also add optional `today?: string` (ISO date). Keep `messages` for existing rows. Check `evaluators.ts` / the HITL scorers for any reads of `input.messages` and keep them working.
- `evals/executors.ts`:
  - When `input.rows` is present, build messages with `buildHistoryMessages(input.rows, { replayTurnMessages: process.env.GCA_EVAL_DISABLE_TURN_REPLAY !== "1" })` flattened. Use the same function as production, not a copy.
  - Append `buildTodayLine(input.today)` to `system`, the same way `runAgentTurn` does.
  - Document `GCA_EVAL_DISABLE_TURN_REPLAY` in one line as eval-only.
- `scripts/push-date-resolution-rows.ts`: add or update two rows with fixed `today: "2026-09-22"`.
  - **(a)** `date-resolution-replay-01`: the 5-turn transcript as `rows`, ending with user "Yes".
    - The turn-3 assistant row carries `turn_messages`: `run_code` tool-call with input, tool-result with the 2026-10-06 → 2026-10-08 finding, then the final text.
    - Expected: `send_booking_link` with args `room1`, `checkIn: "2026-10-06"`, `checkOut: "2026-10-08"`, plus the guest name/email if the transcript supplies them. `send_booking_link` args are scored (`ARGS_SCORED_TOOLS`), so the transcript must include name and email if the expected args do. Otherwise make the expected call name-only and describe the date check in metadata.
    - `expectedAlternative: null`. A `run_code` here is a miss.
  - **(b)** Update `date-resolution-year-01` (cold start "October 11–13 room 1") to expect `check_availability(room1, 2026-10-11, 2026-10-13)`, with `expectedAlternative: "get_current_date"` so an extra date check is not punished. Update its description: today's date is now in the system context.
  - Push with `yarn tsx --env-file=.env.development scripts/push-date-resolution-rows.ts` (needs `BRAINTRUST_API_KEY`).
- Knip: `buildHistoryMessages` is also imported by `tests/agent/memory.test.ts`, and `buildTodayLine` by `run-agent-turn.ts`, so neither is unused-export noise even though `evals/` is outside knip's `project`.

### 14. Documentation

- `ENGINEERING.md`, memory section:
  - Replace the "1600 in, 800" budget line with 8000/6000.
  - Describe the three replay tiers and the `turn_messages` column.
  - Note the today system line and whole-turn trimming.
- No new conditional-docs entry is needed unless an `app_docs` file is added. If one is added, index it in `docs/conditional-docs.md`.

### 15. Run the Validation Commands

- Run every command below. Then run the eval gate and the negative run as described.

## Test Coverage

GCA is a webhook service with no browser surface, so there is no Playwright spec and no `e2e/*.md` journey. The regression layer is this app's existing vitest node suite (`tests/**/*.test.ts`, the GCA equivalent of `*.unit.test.ts`):

- **`tests/agent/memory.test.ts`, "replays a prior turn's tool-call and tool-result verbatim".** This is the core regression. Against today's code, `historyMessages` holds only `{ role, content: string }`, so the 2026 dates the model found never reach it, and the test fails. After the fix it passes.
- **`tests/agent/context.test.ts`, "drops whole turn groups only".** Catches any trim that orphans a tool-call from its result (a provider 400 in prod).
- **`tests/agent/turn-messages.test.ts`.** Catches truncation that corrupts args or hides the marker, and a step-cap tail stored without closing assistant text.
- **`tests/agent/run-guest-turn.test.ts` / `tests/lib/conversations.test.ts`.** Catch `turn_messages` not being persisted at `record-reply`, and duplicate assistant rows on an Inngest retry.
- **`tests/agent/tools/booking.test.ts`.** Pins the new `past_date` refusal text.
- **Eval (behavioural, CI eval gate).**
  - Golden row (a) catches the model re-deriving dates from prose. The negative run (`GCA_EVAL_DISABLE_TURN_REPLAY=1`) must fail row (a), which proves the row detects the regression.
  - Row (b) catches cold-start year guessing.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `git stash`-free before/after check. On the unfixed tree, write the Step 11 regression case first and run `yarn workspace guest-communication-agent vitest run tests/agent/memory.test.ts`. The new case fails. After the fix, the same command passes.
- `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "select trace_id, count(*) from whatsapp_messages where role='assistant' and trace_id is not null group by 1 having count(*)>1;"`. Returns zero rows before applying the migration. Read only.
- `supabase migration up`. Applies the new migration to the shared local DB without a reset.
- `psql … -c "\d whatsapp_messages"`. Shows the `turn_messages jsonb` column and the `whatsapp_messages_assistant_trace_id_key` partial index.
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/guest-communication-agent` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/guest-communication-agent` - Unit tests pass, proving the bug is fixed with zero regressions
- `yarn turbo run build --filter=./apps/guest-communication-agent` - Production build succeeds
- `cd apps/guest-communication-agent && yarn tsx --env-file=.env.development scripts/ci-gate-evals.ts`. The eval gate is green with rows (a) and (b) passing. Needs Braintrust and OpenRouter keys; the same gate runs in CI (`eval-golden.yml`).
- `cd apps/guest-communication-agent && GCA_EVAL_DISABLE_TURN_REPLAY=1 yarn tsx --env-file=.env.development evals/golden-dataset.eval.ts`. The negative run: row (a) must score 0 on "Tool Call Match". Record in the PR how it was run and its result.
- After deploy (manual, owner-driven, not part of the automated pipeline), replay the transcript on WhatsApp:
  - "ASAP" → offer.
  - "Yes" → a Telegram nudge with 2026 dates.
  - Approve → a link with `checkIn=2026-10-06`.
  - Quote the Inngest run ids and the Braintrust trace showing the replayed tool messages in model-1's `gen_ai.input.messages`.

## Notes

- **No new dependency.**
- **Prod migration.** The index creation fails if prod already has duplicate `(trace_id)` assistant rows. Run the duplicate query against prod before merge, via the org owner (the prod migration gate currently relies on `SUPABASE_DB_URL`). If duplicates exist, resolve them deliberately. Folds and watermarks reference message ids, so the migration must not blindly delete rows.
- **Legacy rows.** Existing assistant rows have `turn_messages = null` and replay as text. The fix takes effect from the first turn recorded after deploy. No backfill is possible or needed.
- **Tracing.** No new span attributes. `run-model.ts` already writes `messages` (now including replayed tool messages and truncation markers) to `gen_ai.input.messages`. That means tool outputs from earlier turns now appear in traces. Remember the existing Braintrust `setMaskingFunction` todo; it is out of scope here.
- **Inngest.** `turnMessages` is derived from memoized step outputs, so the result is the same on every replay. The `record-reply` step's own output is still just the row id. `turn_messages` is never returned from a step, so step-state size is unchanged.
- **Out of scope** (per the issue):
  - a "pending offer" side-state or server-side year correction
  - the repeated-reply guard (#114)
  - tool facts inside `guest_memory` folds
  - property timezone
  - `find_first_available` (#85)
- **Git.** Conventional commit, e.g. `fix(gca): persist and replay each turn's tool calls and results`. No `Co-Authored-By` trailer (repo rule). Branch/PR off `develop`.
