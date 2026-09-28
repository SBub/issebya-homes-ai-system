# Bug: GCA assistant replies silently dropped when the webhook trace id is all zeros

## Metadata

issue_number: `127`
adw_id: `0af54f46`
issue_json: `{"number":127,"title":"GCA: assistant replies are silently dropped when the webhook trace id is all zeros — the trace_id dedupe index swallows them, so the agent re-answers every earlier question"}`

## Bug Description

In production (2026-09-23, owner test conversation) the webhook route's instance had no OTel tracer provider registered on a cold start, so `startTraceRoot("webhook.turn", …)` in `apps/guest-communication-agent/src/app/api/webhook/whatsapp/route.ts` got a non-recording span whose context is OTel's `INVALID_SPAN_CONTEXT` (trace id `00000000000000000000000000000000`, span id `0000000000000000`). That anchor rode the `gca/guest-turn.requested` event into `run-guest-turn.ts`, whose `record-reply` step stored it as `whatsapp_messages.trace_id`.

The partial unique index `whatsapp_messages_assistant_trace_id_key` (`(trace_id) where role = 'assistant' and trace_id is not null`) exists to dedupe a retried `record-reply` step. The first zero-id turn inserted its row. The next two zero-id turns hit the index; `recordMessage` treated the `23505` as an Inngest retry and returned the **earlier** row's id from `findAssistantMessageIdByTrace`. Their reply text was never written. Nothing threw, nothing logged, the WhatsApp send still went out, and `update-message-delivery-status` updated turn 1's row.

Expected: every reply sent to the guest has its own `whatsapp_messages` row, so `memory.ts` replays it next turn. Actual: replies from untraced turns after the first are lost; the next turn's model sees several unanswered user questions and re-answers all of them.

## Problem Statement

An OTel-invalid trace id (all zeros) is used as a uniqueness/dedupe key. Distinct replies collide on it, and the retry-dedupe branch in `recordMessage` turns that collision into a silent data loss. The tracing gap that produces the invalid id is itself invisible (no log, no Sentry event).

## Solution Statement

1. Never use an invalid trace id as a dedupe key: `recordMessage` writes `trace_id` only when `isValidTraceId(traceId)` holds (otherwise the column is null, and the partial index does not apply), and reaches its select-after-conflict branch only with a valid id. A unique violation with anything else throws.
2. `run-guest-turn.ts`'s `record-reply` checks the anchor with a new `isValidTraceAnchor` (from `src/lib/tracing.ts`, built on `@opentelemetry/api`'s `isValidTraceId`/`isValidSpanId`), passes `undefined` when it is invalid, and reports the gap (`console.error` + Sentry) with conversation/correlation ids.
3. `startTraceRoot` reports the gap where it originates: when the produced span context is invalid, `console.error` + `Sentry.captureMessage` naming the root span (e.g. `webhook.turn`). No throw anywhere: the guest's turn still completes.
4. Correct the false narrative in the comment of migration `20260922120000_add_turn_messages_to_whatsapp_messages.sql` (comment text only, statements untouched).
5. Record the untraced-instance investigation (desk analysis of `register()`) in the PR description / a follow-up issue. No speculative code change to `instrumentation.ts`.

The all-zeros check lives in exactly one place: `@opentelemetry/api`'s own validators. No 32-zero string literal is introduced in source.

## Steps to Reproduce

Unit-level (no dev server; the GCA port is owned by the webhook gateway and must not be started from a worktree):

1. In `tests/lib/conversations.test.ts`, stub the insert to return `{ code: "23505" }` and the follow-up select to return `{ id: "msg-existing" }`, then call `recordMessage("convo-1", "assistant", "Second reply", "0".repeat(32))`.
2. Current code: the insert payload contains `trace_id: "000…0"` and the call returns `"msg-existing"`, i.e. the new reply is dropped and turn 1's row id is handed back.
3. In `tests/agent/run-guest-turn.test.ts` the shared `TEST_TRACE_ANCHOR` is already the all-zero anchor, and the current assertion is that `recordMessage` receives it as a string trace id, which is exactly the prod behaviour.

Prod evidence (from the issue): `whatsapp_messages` for conversation started 2026-09-23 20:00:48 UTC shows one assistant row (`trace_id=000…0`) for three user rows; Inngest events carry `traceAnchor.traceId = 000…0` for those turns.

## Root Cause Analysis

- `startTraceRoot` trusts `span.spanContext()` unconditionally. With no global tracer provider, `@opentelemetry/api`'s `NoopTracer` returns a `NonRecordingSpan(INVALID_SPAN_CONTEXT)`: all-zero ids. This is a defined OTel sentinel meaning "no trace", not an identifier.
- `run-guest-turn.ts` passes `traceAnchor.traceId` straight into `recordMessage`, so every untraced turn shares the same `trace_id` value.
- `recordMessage` (`src/lib/conversations.ts`) interprets any `23505` on an assistant row with a defined `traceId` as "my own earlier insert already landed" and returns `findAssistantMessageIdByTrace(traceId)`. That assumption only holds when the trace id is unique per turn, which an invalid id is not. Result: silent drop.
- Downstream, `update-message-delivery-status` updates the wrong (earlier) row, and `memory.ts` replays a history missing the replies.
- The same collision is what broke the first prod apply of `20260922120000_…` (11 assistant rows sharing, almost certainly, the zero id), and that migration's dedupe `delete` then removed 10 distinct untraced replies. Its comment currently misattributes them to retried `record-reply` writes and claims the column was hand-added (it arrived via PR #119's push run).
- Why the webhook instance had no provider is **not established** (see Notes). The fix above makes the data path correct regardless, and makes the gap visible in Sentry so the cause can be chased.

## Relevant Files

Use these files to fix the bug:

- `apps/guest-communication-agent/AGENTS.md` — workspace rules: comment only genuine landmines, state a fact once at its canonical definition, no narrative/changelog comments.
- `apps/guest-communication-agent/ENGINEERING.md` — tracing/durability background (read for context; no change expected).
- `apps/guest-communication-agent/app_docs/feature-4f43c209-turn-message-replay.md` — conditional doc for anything touching what `record-reply` stores; confirms the `turn_messages`/replay contract that must stay unchanged.
- `apps/guest-communication-agent/src/lib/tracing.ts` — `TraceAnchor`, `startTraceRoot`. Add `isValidTraceAnchor` and the invalid-root report here.
- `apps/guest-communication-agent/src/lib/conversations.ts` — `recordMessage` and `findAssistantMessageIdByTrace`; the dedupe branch to guard, and its doc comment.
- `apps/guest-communication-agent/src/agent/run-guest-turn.ts` — `record-reply` step; already imports `@sentry/nextjs`.
- `apps/guest-communication-agent/src/app/api/webhook/whatsapp/route.ts` — caller of `startTraceRoot("webhook.turn", …)`; no code change expected (the report lives inside `startTraceRoot`), ack contract unchanged.
- `apps/guest-communication-agent/src/app/api/owner-nudges/[correlationId]/answer/route.ts`, `.../approve/route.ts` — other `startTraceRoot` callers; they inherit the report, no change needed.
- `apps/guest-communication-agent/src/instrumentation.ts` — `register()`, `Sentry.init` (production only); read for the investigation, no change planned.
- `apps/guest-communication-agent/src/agent/memory.ts` — history replay; must stay unchanged (null `trace_id` rows already replay fine, e.g. admin resends).
- `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql` — comment rewrite only.
- `apps/guest-communication-agent/tests/lib/conversations.test.ts` — `recordMessage` unit tests (existing ones use `"run-1"` as a trace id, which is not OTel-valid and must become a valid 32-hex id).
- `apps/guest-communication-agent/tests/agent/run-guest-turn.test.ts` — `record-reply` tests; `TEST_TRACE_ANCHOR` is currently the all-zero anchor.
- `apps/guest-communication-agent/tests/lib/tracing.test.ts` — registers a real in-memory provider; add `isValidTraceAnchor` / `startTraceRoot` invalid-context tests.
- `apps/guest-communication-agent/tests/api/webhook/whatsapp/route.test.ts` — registers no provider, so `startTraceRoot` yields an invalid anchor there; needs a `@sentry/nextjs` mock so the new report stays quiet and asserted.
- `apps/guest-communication-agent/tests/agent/tools/property-question.test.ts` — existing `vi.mock("@sentry/nextjs", …)` pattern to copy.

### New Files

None. (No new migration: the index stays as is.)

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add trace-anchor validity check and invalid-root report in `src/lib/tracing.ts`

- Import `isValidSpanId`, `isValidTraceId` from `@opentelemetry/api` (already a dependency) and `* as Sentry from "@sentry/nextjs"`.
- Add `export function isValidTraceAnchor(anchor: TraceAnchor): boolean` returning `isValidTraceId(anchor.traceId) && isValidSpanId(anchor.spanId)`.
- Add `export function reportUntracedAnchor(site: string, details: Record<string, string | undefined>): void` that does `console.error("[tracing] invalid trace anchor at <site> — no tracer provider registered in this instance", details)` and `Sentry.captureMessage(\`[tracing] invalid trace anchor at ${site}\`, { level: "error", tags: { "gca.trace_gap_site": site }, extra: details })`. Never throws. One short comment stating the landmine once: an OTel-invalid id is the no-provider sentinel and must never be used as an identifier or dedupe key; this is the canonical place, other call sites reference it.
- In `startTraceRoot`, right after reading `span.spanContext()`, if `!isValidTraceAnchor({ traceId, spanId })` call `reportUntracedAnchor(name, {})` (the span name, e.g. `webhook.turn`, identifies the route). Do not throw; still return the anchor so the route's ack path is unchanged.

### 2. Guard the dedupe branch in `recordMessage` (`src/lib/conversations.ts`)

- Import `isValidTraceId` from `@opentelemetry/api`.
- Compute `const dedupeTraceId = traceId !== undefined && isValidTraceId(traceId) ? traceId : undefined;`.
- Write `insert.trace_id` only from `dedupeTraceId` (an invalid id is stored as null, so the partial index does not apply and the row is always inserted).
- Guard the select-after-conflict branch on `dedupeTraceId !== undefined`. Any other `23505` falls through to the existing throw (it cannot be a retry).
- If `traceId` was supplied but invalid, `console.error` once (`[conversations] recordMessage got an invalid trace id; storing null`) so a direct caller bypassing `run-guest-turn`'s check is still visible. No Sentry here (the reporting sites are `startTraceRoot` and `record-reply`).
- Update the doc comment above `recordMessage`: `trace_id` is written only for an OTel-valid id; reference `tracing.ts`'s canonical landmine instead of re-explaining.

### 3. Pass `undefined` for invalid anchors in `record-reply` (`src/agent/run-guest-turn.ts`)

- Import `isValidTraceAnchor`, `reportUntracedAnchor` from `@/lib/tracing`.
- Inside the `record-reply` step's callback (so it runs once per real execution, not per Inngest replay), compute `const traceId = isValidTraceAnchor(traceAnchor) ? traceAnchor.traceId : undefined;`; when undefined call `reportUntracedAnchor("run-guest-turn.record-reply", { conversationId, correlationId, triggerMessageId })`; then call `recordMessage(conversationId, "assistant", replyText, traceId, { turnMessages })`. Pull this into a named function declared above the `steppedSpan` call, per workspace AGENTS.md.
- Update the existing comment above `record-reply` ("traceAnchor.traceId is stored on the row…") to say it is stored only when valid.
- Leave `memory.ts`, `turn_messages` shape, send and delivery-status steps unchanged.

### 4. Rewrite the comment in `supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql`

- Comment text only; do not touch any SQL statement.
- State what happened: the first prod apply (2026-09-22/23, run 35798075273) failed at the unique index because prod held 11 assistant rows sharing one trace id, the all-zero OTel-invalid id written by untraced webhook instances, i.e. 11 distinct replies, not retried writes; the migration rolled back and deployed code ran without the column for about 12 h; the column arrived when PR #119's push run applied this migration (not by hand); the `delete` below removed 10 of those distinct replies (test data) when it ran. `if not exists` stays harmless. Keep it factual and short; do not repeat the "duplicate writes from retried record-reply" rationale.

### 5. Update `tests/lib/conversations.test.ts`

- Introduce `const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";` and replace `"run-1"` in the existing trace-id tests with it (a non-OTel-valid id is now, correctly, not stored).
- New test: "stores an invalid (all-zero) trace id as null and returns the new row id even when another zero-trace assistant row exists": insert resolves `{ data: { id: "msg-new" } }`; call with `"0".repeat(32)`; assert the insert payload has no `trace_id` key, result is `"msg-new"`, and `selectMock` (the conflict lookup) was not called.
- New test: "throws on a unique violation with an invalid trace id instead of returning another row's id": insert resolves `23505`, a lookup stub would return `msg-existing`; assert it rejects with the existing `Failed to record assistant message…` error and the lookup was not called.
- Keep the existing "returns the existing assistant row's id … (Inngest retry)" test, now with `VALID_TRACE_ID`, proving the valid-id dedupe still works.
- Negative check (manual, reported in the PR): temporarily revert the `dedupeTraceId` guard in `conversations.ts`, run `yarn turbo run test --filter=./apps/guest-communication-agent -- tests/lib/conversations.test.ts`, confirm the zero-id tests fail (payload contains `trace_id`, second test returns `msg-existing`), then restore.

### 6. Update `tests/agent/run-guest-turn.test.ts`

- Add `const captureMessageMock = vi.fn(); vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: captureMessageMock }));` (hoisted pattern as in `property-question.test.ts`).
- Change `TEST_TRACE_ANCHOR` to a valid anchor (`{ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" }`) so existing tests describe the normal path; tighten the existing `record-reply` assertion to expect `TEST_TRACE_ANCHOR.traceId` instead of `expect.any(String)`.
- New test: invalid anchor (`INVALID_SPAN_CONTEXT`'s ids, taken from `@opentelemetry/api`'s exported `INVALID_TRACEID`/`INVALID_SPANID` rather than a literal) results in `recordMessageMock` called with `traceId === undefined` and `captureMessageMock` called once with a message containing `run-guest-turn.record-reply`.
- New test ("two zero-anchor turns produce two assistant rows", the local E2E stand-in): run `runGuestTurn` twice with the invalid anchor and different messages, with `recordMessageMock` resolving `"msg-a"` then `"msg-b"`; assert two `recordMessage` calls, both with `undefined` trace id, and `update-message-delivery-status` targeting `msg-a` and `msg-b` respectively.

### 7. Update `tests/lib/tracing.test.ts` and `tests/api/webhook/whatsapp/route.test.ts`

- `tracing.test.ts`: mock `@sentry/nextjs` (`captureMessage`). Test `isValidTraceAnchor` true for a valid pair and false for `INVALID_TRACEID`/`INVALID_SPANID`. Test `startTraceRoot` with the registered in-memory provider returns a valid anchor and does not report; test it with a no-op tracer (e.g. `trace.disable()` then restore the provider in `finally`, or `vi.spyOn(trace, "getTracer")` returning `new ProxyTracerProvider().getTracer("x")`/a `NoopTracer`) returns an invalid anchor and calls `captureMessage` once with `webhook.turn` in the message, without throwing.
- `route.test.ts`: add a `@sentry/nextjs` mock. That suite registers no provider, so assert the happy-path request still returns empty TwiML with status 200 and that `captureMessage` was called naming `webhook.turn` (ack contract unchanged, gap reported).

### 8. Investigation write-up (PR description, not code)

- Do not start a GCA dev server or `vercel dev` from this worktree (port 3005 belongs to the gateway). Reproducing the cold-instance gap is a post-deploy step.
- Record the desk finding in the PR description: in `register()`, `shared[REGISTERED_KEY] = true` is set before the awaited dynamic imports and before `trace.setGlobalTracerProvider`; if any step between throws (dynamic import failure, Braintrust `setupOtelCompat`, the production Axiom guard), the flag stays set and the instance never gets a provider while routes keep running. Also possible: a request served before `register()` resolves on a cold instance, or a second `@opentelemetry/api` copy in the route bundle. None is proven, so no code change; open a follow-up issue with this evidence and the new Sentry tag `gca.trace_gap_site` to query next time.

### 9. Run the validation commands

- Run every command in `Validation Commands` below and fix anything that fails.

No browser coverage: the change is confined to `apps/guest-communication-agent` (a webhook service with no browser surface) and a migration comment, so neither a Playwright spec nor an `e2e/*.md` journey applies.

## Test Coverage

- `apps/guest-communication-agent/tests/lib/conversations.test.ts` (unit, node): `recordMessage` with an all-zero trace id stores `trace_id` null and returns the new row id; a `23505` with an invalid id throws instead of returning another row's id; valid-id retry dedupe still returns the existing id. Fails against the unfixed code (payload contains the zero `trace_id`; conflict returns `msg-existing`).
- `apps/guest-communication-agent/tests/agent/run-guest-turn.test.ts` (unit, node): invalid anchor leads to `recordMessage(…, undefined, …)` plus a Sentry `captureMessage`; valid anchor passes its trace id through; two zero-anchor turns yield two distinct recorded rows. Fails against the unfixed code (zero id passed through, no Sentry call).
- `apps/guest-communication-agent/tests/lib/tracing.test.ts` and `tests/api/webhook/whatsapp/route.test.ts` (unit, node): `startTraceRoot` without a provider reports the gap and does not throw; the webhook still acks with empty TwiML.
- Migration comment change: no test needed, it is comment text in a file whose statements are unchanged.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `git stash push -m "adw-0af54f46-negcheck" -- apps/guest-communication-agent/src/lib/conversations.ts && yarn turbo run test --filter=./apps/guest-communication-agent -- tests/lib/conversations.test.ts; git stash apply "$(git stash list --format='%H %gs' | grep adw-0af54f46-negcheck | head -1 | cut -d' ' -f1)"` - Negative check (run after the tests and fix are written): with the `recordMessage` guard reverted, the new zero-id tests must fail. Then drop that stash entry by its tag. Alternatively revert the guard by hand, run, and restore.
- `yarn turbo run test --filter=./apps/guest-communication-agent` - All GCA unit tests pass, including the new regression tests
- `yarn workspace guest-communication-agent typecheck` - Workspace types are sound
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/guest-communication-agent` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (`isValidTraceAnchor`/`reportUntracedAnchor` must both have non-test importers)
- `yarn lint && yarn typecheck && yarn test` - Repo-wide gates stay green
- `yarn turbo run build --filter=./apps/guest-communication-agent` - Production build succeeds
- `git diff develop -- supabase/migrations/20260922120000_add_turn_messages_to_whatsapp_messages.sql | grep '^[+-]' | grep -v '^[+-]--' | grep -v '^[+-]\{3\}'` - Must print nothing: only comment lines changed in the migration

## Notes

- No new dependency: `@opentelemetry/api` and `@sentry/nextjs` are already GCA dependencies.
- Sentry only initialises in production (`instrumentation.ts`); in dev/test `captureMessage` is a no-op, which is why tests mock it. The `console.error` is the dev-visible signal.
- The partial unique index stays; no new migration. Existing prod rows with the zero trace id keep it (only one can exist per the index); they replay fine. Recovering the two lost replies is out of scope.
- Braintrust prompt, `memory.ts` replay and `turn_messages` semantics are untouched (issue #113 contract).
- Base branch: the repo's default is `develop` (the git status names `master` as main; follow the ADW pipeline's configured base).
- Post-deploy verification (manual, for the PR): after ≥15 min idle, send three WhatsApp messages 30 s apart; paste `select role, trace_id, created_at from whatsapp_messages where conversation_id = … order by created_at` showing one assistant row per user row, and, if any assistant `trace_id` is null, the Sentry event tagged `gca.trace_gap_site=webhook.turn`. Then hit `/api/health`.
- The eval gate must stay green; nothing here changes model inputs for traced turns.
