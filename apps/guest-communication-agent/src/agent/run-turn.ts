import type { Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { loadPrompt } from "braintrust";
import type { GetStepTools } from "inngest";
import { type AgentMemory, foldMemory, loadMemory } from "@/agent/memory";
import { requestApprovalGate } from "@/agent/tools/approval-gate";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import {
  BOOKING_LINK_APPROVAL_EVENT,
  BOOKING_LINK_APPROVAL_TIMEOUT,
  buildBookingApprovalReason,
  runSendBookingLink,
  sendBookingLink,
} from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { getCurrentDate, runGetCurrentDate } from "@/agent/tools/current-date";
import {
  handleMissingInfoNoReply,
  MISSING_INFO_REPLY_TIMEOUT,
  missingInfo,
  OWNER_NUDGE_ANSWERED_EVENT,
} from "@/agent/tools/missing-info";
import { type OwnerNudgeReason, requestOwnerNudge } from "@/agent/tools/owner-nudge";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runCode, runRunCode } from "@/agent/tools/run-code";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { recordMessage, updateMessageDeliveryStatus } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
import {
  insertPendingOwnerDecision,
  resolvePendingOwnerDecisionByCorrelationId,
} from "@/lib/pending-owner-decisions";
import {
  markSpanFailed,
  recordMissingInfoTraceAnchor,
  steppedSpan,
  type TraceAnchor,
  updateSpanIO,
  withTurnSpan,
} from "@/lib/tracing";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

// GCA's reasoning loop: build the message list, then repeatedly call the
// model and dispatch any tool calls it requested, until a final text reply
// or the step cap fires. Stateless per invocation — loadMemory reloads guest
// history fresh from Postgres every turn.
//
// This file also holds runGuestTurn (the plain delivery orchestrator) and
// runGuestTurnFunction, the Inngest function that wraps it and is registered
// with the /api/inngest serve endpoint (see src/app/api/inngest/route.ts).
// The webhook route triggers it fire-and-forget by sending
// GUEST_TURN_REQUESTED_EVENT. runGuestTurn is kept as a plain, directly
// callable/testable function so tests can drive it with a hand-rolled `step`
// mock instead of a real Inngest engine.
//
// runAgentTurn itself stays free of guest-delivery side effects (recording
// the reply, the proactive Twilio send) so it's easy to test/reason about in
// isolation, while runGuestTurn is the thing that adds those on top.

const MODEL = "deepseek/deepseek-v4-pro";

// The system prompt lives in Braintrust (project BRAINTRUST_PROJECT_ID,
// slug below), not this repo. No pinned version id here — Braintrust's
// loadPrompt(), when called with neither `version` nor `environment`,
// fetches the slug's latest saved version, so every save in Braintrust's UI
// is immediately what this app uses on the next request. This would ideally
// be `environment: "production"` instead, so edits don't go live until
// explicitly promoted, but Environments is a Pro-plan-only feature,
// unavailable in this org. Braintrust is still the sole source of version
// control — nothing in this repo needs to change to ship an edited prompt.
// Deliberately no version-pinning override, including for evals/CI — a
// pinned eval would validate a prompt that isn't necessarily what's live in
// prod, defeating the point of the eval gate.
const SYSTEM_PROMPT_SLUG = "gca-system";

// Reasoning rounds, not individual tool calls (one round can dispatch several).
const MAX_AGENT_STEPS = 8;

// Guest-facing text used whenever the model's own reply can't be used
// as-is — currently: a final round with no tool calls and blank text (see
// modelTurn's markSpanFailed call for the trace-visible side of this same
// condition), and runGuestTurn's own "no assistant message at all" case.
// Sending the model's raw "" straight to Twilio 400s (a message body can't
// be empty), which is what silently ate a guest's reply before this existed.
const FALLBACK_REPLY_TEXT = "Sorry, I couldn't process that — please try again shortly.";

// `.chat(MODEL)` targets Chat Completions — bare `openrouter(MODEL)` would
// target the Responses API, which OpenRouter doesn't support.
const model = openrouter.chat(MODEL);

// MODEL is a reasoning model: its internal "thinking" tokens draw from the
// same completion budget as the visible reply, so too low a cap can make it
// silently return an empty string. 1000 leaves headroom for both.
const MAX_OUTPUT_TOKENS = 1000;

// RULE: tool files (src/agent/tools/*.ts, except approval-gate.ts) must stay
// pure — no step/span/Inngest imports. All durability/tracing plumbing
// belongs here, in run-turn.ts's dispatch loop, or in approval-gate.ts's
// shared gate. Reason: keeps "where's the real business logic" (any tools/*
// file) a one-glance answer, separate from "where's the durability/tracing
// plumbing" (this file + approval-gate.ts). booking.ts is the model for what
// "pure" looks like. One deliberate, narrow exception: property-question.ts
// keeps a plain OTel span (no step, no Inngest) around its own DB call — see
// that file's own comment for why.

// Schema-only tool declarations — dispatch happens manually in runToolCall()
// below. Every key here is the literal snake_case tool name the model sees
// via native tool-calling — the TS identifiers on the right (sendBookingLink,
// wantsHuman, etc.) stay camelCase; only the model-facing string names are
// snake_case.
const tools = {
  get_pricing: getPricing,
  check_availability: checkAvailability,
  answer_property_question: answerPropertyQuestion,
  send_booking_link: sendBookingLink,
  get_current_date: getCurrentDate,
  run_code: runCode,
  wants_human: wantsHuman,
  missing_info: missingInfo,
} satisfies ToolSet;

// Tools whose dispatch itself calls step.run/step.waitForEvent (via this
// file's own private dispatchWantsHuman/runMissingInfo/dispatchGatedToolCall
// — the last of these also calls into approval-gate.ts's requestApprovalGate
// for any APPROVAL_GATES-gated tool, send_booking_link today) — see the "tool
// files stay pure" rule above for why that plumbing lives here rather than in
// wants-human.ts/missing-info.ts/booking.ts themselves. Inngest doesn't
// support calling a step tool from inside another step.run()'s callback —
// the callback must be a self-contained unit of work — so wants_human,
// missing_info, and send_booking_link are all dispatched directly from the
// loop below (never wrapped in an outer step.run). Every other tool has no
// step usage of its own, so wrapping the whole call in one step.run is safe
// and gives it real memoization/replay safety.
const SELF_STEPPED_TOOLS = new Set(["wants_human", "missing_info", "send_booking_link"]);

// The gating POLICY table: which tools require real owner approve/reject
// before they're allowed to dispatch, and how (which Telegram nudge reason
// text/category, which Inngest event, how long to wait for a decision).
// Deliberately visible here, in the runtime dispatch loop, rather than
// buried inside each tool's own file — this is the one place to read
// "which tool calls need approval and how" at a glance. The generic
// suspend/nudge/wait MECHANISM those approved tools reuse lives in
// approval-gate.ts's requestApprovalGate; this table only supplies the
// per-tool policy values that mechanism needs.
//
// wants_human and missing_info have no entry here on purpose: wants_human is
// a one-way alert with no decision to approve, and missing_info's
// suspend/resume resolves to an answer STRING to embed in the KB, not a
// yes/no decision — neither is approve/reject-shaped, so neither goes
// through this gate. Both still dispatch via SELF_STEPPED_TOOLS below,
// exactly as before.
//
// Pulled out as its own named type (not inlined into APPROVAL_GATES' own
// declaration) so dispatchGatedToolCall further down can accept one without
// repeating the object-literal shape at both definition sites.
interface ApprovalGateConfig {
  reasonCategory: OwnerNudgeReason;
  buildReason: (input: Record<string, unknown>) => string;
  event: string;
  timeout: string;
}

const APPROVAL_GATES: Partial<Record<string, ApprovalGateConfig>> = {
  send_booking_link: {
    reasonCategory: "send_booking_link",
    buildReason: (input) =>
      buildBookingApprovalReason(input as Parameters<typeof buildBookingApprovalReason>[0]),
    event: BOOKING_LINK_APPROVAL_EVENT,
    timeout: BOOKING_LINK_APPROVAL_TIMEOUT,
  },
};

// One model call per round. Since none of `tools` has an `execute`,
// generateText only ever returns the model's requested tool calls — it
// never runs them itself.
interface ModelTurnResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>;
  response: { messages: ModelMessage[] };
}

// A reasoning model can burn its whole completion on internal "thinking"
// tokens and come back with neither a text reply nor a tool call —
// generateText doesn't treat that as an error (finishReason is often "stop",
// not "length" — i.e. the model itself thinks it's done), so left alone this
// silently looks like a successful, no-op turn everywhere except the guest,
// who gets nothing back. Retrying is cheap insurance against exactly that
// kind of transient flakiness. "content-filter" is the one finishReason
// retrying can't fix — a deterministic moderation block — so that's the only
// reason this gives up immediately instead of spending the remaining
// attempts. 3 total attempts, not 3 retries: the first pass through the loop
// below counts as attempt 1.
const MAX_MODEL_ATTEMPTS = 3;

async function modelTurn(
  system: string,
  messages: ModelMessage[],
  turnAnchor: TraceAnchor,
): Promise<ModelTurnResult> {
  async function runModelChatTurn(span: Span): Promise<ModelTurnResult> {
    // Plain non-generic closure over `tools`, purely so `typeof callModel`
    // below gives `result` the exact GenerateTextResult<typeof tools, ...>
    // shape — `ReturnType<typeof generateText>` on the generic function
    // itself widens back to a bare ToolSet and loses the specific tool
    // types.
    const callModel = () =>
      generateText({
        model,
        system,
        messages,
        tools,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });

    let result: Awaited<ReturnType<typeof callModel>>;
    let attempt = 0;
    for (;;) {
      attempt++;
      result = await callModel();
      const isEmpty = result.text.trim() === "" && result.toolCalls.length === 0;
      if (!isEmpty || result.finishReason === "content-filter" || attempt >= MAX_MODEL_ATTEMPTS) {
        break;
      }
      console.warn(
        `[run-turn] modelTurn got empty output on attempt ${attempt}/${MAX_MODEL_ATTEMPTS} (finishReason: ${result.finishReason}) — retrying`,
      );
      // Same signal as the console.warn above, but attached to the span so
      // it's visible in the Axiom/Braintrust trace itself, not just server
      // logs nobody is watching.
      span.addEvent("gen_ai.retry", {
        attempt,
        finishReason: result.finishReason,
      });
    }

    span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
    span.setAttribute("gen_ai.output.messages", JSON.stringify(result.response.messages));
    span.setAttribute("gen_ai.response.finish_reason", result.finishReason);
    span.setAttribute("gen_ai.request.attempt_count", attempt);
    // Duplicated under braintrust.* so it actually shows up as this
    // span's Input/Output in Braintrust's UI — the gen_ai.* attributes
    // above alone only ever land in Metadata. See the doc comment above
    // withTurnSpan in tracing.ts for the full braintrust.* mapping.
    span.setAttribute("braintrust.input", JSON.stringify(messages));
    span.setAttribute("braintrust.output", JSON.stringify(result.response.messages));
    // Optional chaining: `usage` is always present on a real AI SDK
    // generateText() result, but test mocks in this repo return a
    // trimmed-down shape without it.
    if (result.usage?.inputTokens !== undefined) {
      span.setAttribute("gen_ai.usage.input_tokens", result.usage.inputTokens);
    }
    if (result.usage?.outputTokens !== undefined) {
      span.setAttribute("gen_ai.usage.output_tokens", result.usage.outputTokens);
    }
    if (result.usage?.inputTokenDetails?.cacheReadTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_read.input_tokens",
        result.usage.inputTokenDetails.cacheReadTokens,
      );
    }
    if (result.usage?.inputTokenDetails?.cacheWriteTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_creation.input_tokens",
        result.usage.inputTokenDetails.cacheWriteTokens,
      );
    }
    // Still empty after MAX_MODEL_ATTEMPTS (or gave up early on a
    // content-filter finish) — flag it so it shows up as an ERROR span
    // instead of blending into every other "OK" span in the trace. See
    // markSpanFailed's own comment for why this doesn't need to throw to
    // be visible.
    if (result.text.trim() === "" && result.toolCalls.length === 0) {
      markSpanFailed(
        span,
        `model returned empty text and no tool calls after ${attempt} attempt(s) (finishReason: ${result.finishReason}, outputTokens: ${result.usage?.outputTokens ?? "unknown"})`,
      );
    }

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input as Record<string, unknown>,
      })),
      response: { messages: result.response.messages },
    };
  }

  return withTurnSpan(
    turnAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    runModelChatTurn,
  );
}

// Detects the soft-fail result shapes a tool can hand back to
// dispatchToolExecution below WITHOUT throwing — a real exception already
// gets recordException + ERROR status for free from withTurnSpan's own catch
// block (see tracing.ts), so this is only for the intentional "return an
// error object instead of throwing" shapes. Two known shapes flow through
// here today:
//   - run_code's SandboxResult ({ ok: false, error, logs } — see
//     sandbox.ts's runInSandbox, every one of its early-return branches uses
//     this shape).
//   - runToolCall's own "unknown tool name" fallback (its switch's default
//     case, below), which returns a bare { error: string } with no `ok`
//     field at all.
// Deliberately narrow, not "does this object have an `error` key anywhere":
// several tools return a plain, successful object that happens to contain an
// `error`-named field as part of normal (non-exceptional) data — e.g.
// checkAvailability's { available: false, error: "Invalid date format" } for
// a malformed date range, which is a valid tool result, not a dispatch
// failure. Only `ok === false` explicitly, or the fallback's exact
// single-key `{ error: string }` shape, count as a soft-fail here — anything
// else (a plain string, a plain object with other fields, `ok: true`, no
// `ok`/`error` fields at all) is left alone and never marked failed.
function detectToolSoftFailure(output: unknown): string | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }
  const record = output as Record<string, unknown>;
  if (record.ok === false) {
    return typeof record.error === "string" ? record.error : "tool call failed";
  }
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "error" && typeof record.error === "string") {
    return record.error;
  }
  return null;
}

// Shared by every non-gated, non-self-stepped tool's execution span (the
// generic dispatch further down in runAgentTurn's loop). Runs `execute`, then
// records gca.tool.input/gca.tool.output + braintrust.input/braintrust.output
// on the steppedSpan already open around this call (see tracing.ts's
// withTurnSpan doc comment for why the braintrust.* duplication exists) — the
// same 4 attributes every one of these call sites used to set by hand. Not
// used by dispatchWantsHuman/runMissingInfo/dispatchGatedToolCall below: none
// of the three knows its tool call's real output at span-creation time (a
// gated call's approval hasn't even been decided yet), so each patches output
// in retroactively via updateSpanIO instead — see each of their own comments.
//
// Also marks the span ERROR (via markSpanFailed, same mechanism
// runGuestTurn's own send-whatsapp-reply call site already uses for
// sendWhatsAppMessage's own soft-fail shape) when `execute`'s result looks
// like an intentional soft-fail rather than a real success — see
// detectToolSoftFailure's own comment for exactly which shapes qualify. This
// is the one choke point every non-self-stepped tool call (including the
// "unknown tool name" fallback, which reaches here the same way any other
// unrecognized-but-not-gated tool name would — see runToolCall's default
// case below) dispatches through, so putting the check here covers all of
// them without touching each tool's own file. Purely additive: does not
// throw, does not change `output`, does not alter the caller's control flow
// — a soft-failed call still returns its normal (now span-marked) result.
async function dispatchToolExecution<T>(
  span: Span,
  input: Record<string, unknown>,
  execute: () => Promise<T>,
): Promise<T> {
  const output = await execute();
  span.setAttribute("gca.tool.input", JSON.stringify(input));
  span.setAttribute("gca.tool.output", JSON.stringify(output));
  span.setAttribute("braintrust.input", JSON.stringify(input));
  span.setAttribute("braintrust.output", JSON.stringify(output));
  const failureMessage = detectToolSoftFailure(output);
  if (failureMessage !== null) {
    markSpanFailed(span, failureMessage);
  }
  return output;
}

// Creates the real gen_ai.tool.wants_human execution span FIRST (its
// `input` — the model's `reason` — is the one thing already known at this
// point), then sends the owner nudge as its real child (not a sibling of the
// turn's own anchor), then patches the span's `output` retroactively once
// runWantsHuman()'s result exists. Same shape runMissingInfo below gives
// gen_ai.tool.missing_info and its own owner_nudge.missing_info sub-span —
// see that function's own comment for the full reasoning — just without a
// step.waitForEvent in between, since wants_human is a one-way alert with no
// suspend/resume: runWantsHuman()'s result is a constant, known immediately
// after the nudge send, not after some later cross-request event. This is
// the "durability/tracing plumbing" half of wants_human that used to live in
// wants-human.ts's own runWantsHuman before the "tool files stay pure" rule
// above — see that file's own comment. Private: only called from
// runToolCall's "wants_human" case below, never nested inside another
// step.run (see SELF_STEPPED_TOOLS's comment for why).
async function dispatchWantsHuman(
  args: { reason: string },
  context: ToolContext,
): Promise<ReturnType<typeof runWantsHuman>> {
  const { conversationId, phone, step, traceAnchor } = context;

  // Only `fn`'s return value (the real OTel-generated span id) survives this
  // step — the span itself has already closed by the time this resolves, no
  // live Span object can survive across this (or any) Inngest step boundary.
  // Same pattern runMissingInfo's own toolSpanId uses below.
  const toolSpanId = await steppedSpan(
    step,
    "tool-wants_human",
    traceAnchor,
    "gen_ai.tool.wants_human",
    {
      "gen_ai.tool.name": "wants_human",
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(args),
      "braintrust.input": JSON.stringify(args),
    },
    async (span) => span.spanContext().spanId,
  );
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  const nudged = await steppedSpan(
    step,
    "owner-nudge-wants-human",
    toolAnchor,
    "owner_nudge.wants_human",
    // braintrust.tags is also what gets this span past @braintrust/otel's
    // export filter at all (see tracing.ts's attribute-namespace comment
    // block, 4th bullet) — this span's other attributes (gca.*) don't match
    // any filter prefix. Mirrors approval-gate.ts's sendGatedOwnerNudge,
    // which tags its own nudge span the same way for the same reason.
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "braintrust.tags": ["wants_human"],
    },
    () =>
      requestOwnerNudge({
        conversationId,
        phone,
        reason: args.reason,
        reasonCategory: "wants_human",
        step,
      }),
  );

  const result = runWantsHuman(nudged);

  // Retroactively patches the tool-call span's output now that it's known —
  // same mechanism (and the same "best-effort, not guaranteed to land"
  // reliability caveat — see updateSpanIO's own doc comment) runMissingInfo
  // below already uses for its own gen_ai.tool.missing_info span's output.
  // Own step, not a span — patching a span isn't itself a new event worth
  // its own trace node.
  await step.run("update-wants-human-trace-io", () => updateSpanIO(toolSpanId, { output: result }));

  return result;
}

// missing_info's full suspend/resume dispatch: creates the real
// gen_ai.tool.missing_info execution span FIRST (its `input` — the model's
// `reason` — is the one thing already known at this point), then sends the
// owner nudge and genuinely suspends via step.waitForEvent until the owner
// replies (handleMissingInfoReplyReceived, called from the API route, sends
// OWNER_NUDGE_ANSWERED_EVENT) or the timeout elapses, running the
// no-reply-timeout fallback step in that case. This is the "durability/
// tracing plumbing" half of missing_info that used to live in
// missing-info.ts's own runMissingInfo/waitForMissingInfoReply before the
// "tool files stay pure" rule above — see missing-info.ts's own comment.
// Private and named to match the tool-dispatch pattern used elsewhere in
// this switch (no exported runMissingInfo exists in missing-info.ts anymore,
// so no import to shadow) — called from runToolCall's "missing_info" case
// below, never nested inside another step.run (see SELF_STEPPED_TOOLS's
// comment for why).
async function runMissingInfo(
  args: { reason: string },
  context: ToolContext,
): Promise<{ escalated: true; answer: string } | { escalated: true; message: string }> {
  const { conversationId, phone, step, correlationId, traceAnchor } = context;

  // Created FIRST, before the nudge, so owner_nudge.missing_info/
  // missing_info.no_reply below nest as its real children instead of
  // siblings of the turn's own anchor — same shape every other tool's
  // execution span already has relative to its own sub-steps. Only `fn`'s
  // return value (the real OTel-generated span id, same pattern
  // runAgentTurn's own "start-trace" step uses for guestTurnSpanId) survives
  // this step — the span itself has already closed by the time this
  // resolves, since no live Span object can survive across this (or any)
  // Inngest step boundary. `output` isn't set here because it isn't known
  // yet; it's patched in retroactively, once the real result exists, via
  // updateSpanIO at the bottom of this function — see that call's own
  // comment for the same reliability caveat updateSpanIO's own doc comment
  // already flags.
  const toolSpanId = await steppedSpan(
    step,
    "tool-missing_info",
    traceAnchor,
    "gen_ai.tool.missing_info",
    {
      "gen_ai.tool.name": "missing_info",
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(args),
      "braintrust.input": JSON.stringify(args),
    },
    async (span) => span.spanContext().spanId,
  );
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  // Best-effort write, own step (not a span — this is pure DB bookkeeping,
  // not something worth showing in Braintrust's UI) — see
  // recordMissingInfoTraceAnchor's own doc comment in tracing.ts for what
  // this is for (letting the owner-nudges answer route, a separate HTTP
  // request that may run hours later on a different server instance, nest
  // its own embedding-step span under toolAnchor) and its known
  // orphaned-row gap when the owner never replies. Only written when a real
  // correlationId exists — every real run does supply one (see
  // GuestTurnRequestedEventData), this guard is for hypothetical callers
  // outside a live run (see ToolContext.correlationId's own comment).
  if (correlationId) {
    await step.run("record-missing-info-trace-anchor", () =>
      recordMissingInfoTraceAnchor(correlationId, toolAnchor),
    );
  }

  // Its own step, distinct from "wait-for-owner-answer" below — sending the
  // nudge and waiting for the reply are two different kinds of operation,
  // each needing its own memoized step id (see steppedSpan's doc comment in
  // tracing.ts for why un-stepped code would otherwise re-send this real
  // Telegram nudge on every replay).
  // braintrust.tags is also what gets this span past @braintrust/otel's
  // export filter at all (see tracing.ts's attribute-namespace comment
  // block, 4th bullet) — same reason dispatchWantsHuman's own nudge span
  // above sets it.
  const nudged = await steppedSpan(
    step,
    "owner-nudge-missing-info",
    toolAnchor,
    "owner_nudge.missing_info",
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "braintrust.tags": ["missing_info"],
    },
    () =>
      requestOwnerNudge({
        conversationId,
        phone,
        reason: args.reason,
        reasonCategory: "missing_info",
        correlationId,
        step,
      }),
  );

  // Every exit path below funnels into this one shared value instead of
  // returning early, so there's a single result to both hand back to the
  // model and retroactively patch onto the tool-call span's output below —
  // starts as the nudge-failed/timeout fallback since that's also the
  // fallback for the "nudge never sent" branch that skips the block below
  // entirely. Branches on `nudged` (already known at this point) so a failed
  // nudge gets an honest message instead of falsely claiming the owner was
  // notified.
  let result: { escalated: true; answer: string } | { escalated: true; message: string } = nudged
    ? { escalated: true, message: "The owner has been notified and will be in touch shortly." }
    : {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      };

  // Nudge failed to send — skip straight to the same fallback a timeout
  // would produce; there's no point suspending if the owner was never told.
  if (nudged) {
    // Best-effort bookkeeping (see insertPendingOwnerDecision's own doc
    // comment) — own step, only reached once the nudge is confirmed sent.
    // Guarded on correlationId same as recordMissingInfoTraceAnchor's own
    // call site above: only real runs supply one (see
    // ToolContext.correlationId's own comment); there's nothing to key a row
    // on for hypothetical callers outside a live run.
    if (correlationId) {
      await step.run("record-pending-decision", () =>
        insertPendingOwnerDecision({
          correlationId,
          toolName: "missing_info",
          conversationId,
          phone,
          reason: args.reason,
        }),
      );
    }

    const waitResult = await step.waitForEvent("wait-for-owner-answer", {
      event: OWNER_NUDGE_ANSWERED_EVENT,
      match: "data.correlationId",
      timeout: MISSING_INFO_REPLY_TIMEOUT,
    });

    const answer = (waitResult?.data.answer as string | undefined) ?? null;
    if (answer !== null) {
      // Embedding already happened in handleMissingInfoReplyReceived before
      // OWNER_NUDGE_ANSWERED_EVENT delivered this answer here — do not
      // re-embed here.
      result = { escalated: true, answer };
      // Own step — same replay-safety reasoning as the nudge-send step above.
      // Mirrors missing-info-no-reply's own marker span, for the symmetric
      // "an answer was received and consumed" case.
      await steppedSpan(
        step,
        "missing-info-answer-received",
        toolAnchor,
        "missing_info.answer_received",
        { "gca.correlation_id": correlationId ?? "unknown", "braintrust.tags": ["missing_info"] },
        async () => {},
      );
      if (correlationId) {
        await step.run("resolve-pending-decision", () =>
          resolvePendingOwnerDecisionByCorrelationId(correlationId, "answered"),
        );
      }
    } else {
      console.warn(
        `[run-turn] runMissingInfo timed out after ${MISSING_INFO_REPLY_TIMEOUT} waiting for correlationId ${correlationId ?? "unknown"}'s reply`,
      );
      // Own step — same replay-safety reasoning as the nudge-send step above.
      // braintrust.tags clears the same export filter as the nudge span above
      // (see tracing.ts's attribute-namespace comment block, 4th bullet) — this
      // isn't an approve/reject decision (approval-gate.ts's
      // braintrust.approval_decision doesn't apply here; a missing_info timeout
      // means "gave up waiting for the KB answer," not a rejected gate), so it
      // reuses the sibling nudge span's tagging mechanism instead.
      await steppedSpan(
        step,
        "missing-info-no-reply",
        toolAnchor,
        "missing_info.no_reply",
        {
          "gca.timeout": MISSING_INFO_REPLY_TIMEOUT,
          "braintrust.tags": ["missing_info"],
          "gca.correlation_id": correlationId ?? "unknown",
        },
        () => handleMissingInfoNoReply({ correlationId: correlationId ?? "unknown" }),
      );
      if (correlationId) {
        await step.run("resolve-pending-decision-timeout", () =>
          resolvePendingOwnerDecisionByCorrelationId(correlationId, "timeout"),
        );
      }
      // Timed out — handleMissingInfoNoReply already ran above; result keeps
      // its default fallback-message value.
    }
  }

  // Retroactively patches the tool-call span's real output now that it's
  // known — missing_info's actual resolution (the owner's real answer, or
  // the fallback message) isn't knowable until after step.waitForEvent above
  // has already resolved (or was skipped), well after the span itself was
  // created and closed above, so there's no live Span object left to call
  // span.setAttribute on. Same mechanism (and the same "best-effort, not
  // guaranteed to land" reliability caveat — see updateSpanIO's own doc
  // comment, still under separate investigation per
  // docs/braintrust-online-eval-testing.md) runAgentTurn's own
  // "braintrust.guest_turn" root marker span already uses for its output.
  // Own step, not a span — patching a span isn't itself a new event worth
  // its own trace node.
  await step.run("update-missing-info-trace-io", () =>
    updateSpanIO(toolSpanId, { output: result }),
  );

  return result;
}

// APPROVAL_GATES-gated dispatch (send_booking_link today, any future gated
// tool tomorrow): creates the real gen_ai.tool.<name> execution span FIRST —
// before requestApprovalGate ever runs — with the model's real tool-call
// `input` set at creation, same shape dispatchWantsHuman/runMissingInfo above
// give their own tool spans. Only `fn`'s return value (the real
// OTel-generated span id) survives this step — same pattern those two
// functions' own toolSpanId uses, for the same reason (no live Span object
// survives an Inngest step boundary). That id becomes a new toolAnchor,
// passed to requestApprovalGate as its own traceAnchor param, so the
// nudge/decision/timeout spans requestApprovalGate creates internally become
// this tool-call span's real children instead of siblings of the turn's own
// anchor — the same reparenting runMissingInfo's own
// owner_nudge.missing_info/missing_info.no_reply already get relative to
// gen_ai.tool.missing_info, just crossing into approval-gate.ts's shared
// mechanism instead of being entirely local to this file.
//
// Every outcome funnels into one updateSpanIO patch on toolSpanId, unlike
// the pre-fix behavior where only the approved path ever got an execution
// span at all: a rejected/timed-out call patches the same not-approved shape
// already returned to the model; an approved call patches the real
// execution result. Private: only called from the loop's SELF_STEPPED_TOOLS
// branch below, never nested inside another step.run — safe to call from
// there because, like dispatchWantsHuman/runMissingInfo, this function calls
// step.run/requestApprovalGate itself rather than being called from inside
// one (see SELF_STEPPED_TOOLS's own comment for why that nesting is unsafe).
async function dispatchGatedToolCall(
  call: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  gate: ApprovalGateConfig,
  correlationId: string,
  context: ToolContext,
): Promise<unknown> {
  const { conversationId, phone, step, traceAnchor } = context;

  const toolSpanId = await steppedSpan(
    step,
    `tool-${call.toolName}`,
    traceAnchor,
    `gen_ai.tool.${call.toolName}`,
    {
      "gen_ai.tool.name": call.toolName,
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(call.input),
      "braintrust.input": JSON.stringify(call.input),
    },
    async (span) => span.spanContext().spanId,
  );
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  const approved = await requestApprovalGate({
    toolName: call.toolName,
    event: gate.event,
    timeout: gate.timeout,
    reason: gate.buildReason(call.input),
    reasonCategory: gate.reasonCategory,
    conversationId,
    phone,
    correlationId,
    step,
    traceAnchor: toolAnchor,
    // The model's own real tool-call args — captured on this call's
    // pending_owner_decisions row (see requestApprovalGate's own `context`
    // param) so a later manual-resolve action can rebuild what this call
    // would have done (e.g. send_booking_link's room/checkIn/checkOut)
    // without re-parsing gate.buildReason's human-readable prose.
    context: call.input,
  });

  // requestApprovalGate itself doesn't distinguish a rejection from a
  // timeout in its return value (both resolve `approved: false` — see its
  // own doc comment), so neither does this: same not-approved shape the
  // model has always seen on either exit path.
  if (!approved) {
    const result = {
      approved: false,
      message: "This action was not approved. Do not retry it automatically.",
    };
    await step.run(`update-${call.toolName}-trace-io`, () =>
      updateSpanIO(toolSpanId, { output: result }),
    );
    return result;
  }

  // Own step, distinct from the tool-span-creation step above — this is the
  // call's real dispatch (runSendBookingLink today), memoized separately so a
  // replay after some later suspend elsewhere in the same turn doesn't
  // re-run it.
  const output = await step.run(`execute-${call.toolName}`, () =>
    runToolCall(call.toolName, call.input, context),
  );
  await step.run(`update-${call.toolName}-trace-io`, () => updateSpanIO(toolSpanId, { output }));
  return output;
}

// Dispatches a requested tool call to its run<ToolName> implementation.
// Called after any configured APPROVAL_GATES check has already approved the
// call (see below), never before it.
async function runToolCall(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "get_pricing":
      return runGetPricing(input as Parameters<typeof runGetPricing>[0]);
    case "check_availability":
      return runCheckAvailability(input as Parameters<typeof runCheckAvailability>[0]);
    case "answer_property_question":
      return runAnswerPropertyQuestion(input as Parameters<typeof runAnswerPropertyQuestion>[0]);
    case "send_booking_link":
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0], {
        phone: context.phone,
      });
    case "get_current_date":
      return runGetCurrentDate();
    case "run_code":
      return runRunCode(input as Parameters<typeof runRunCode>[0]);
    case "wants_human":
      return dispatchWantsHuman(input as { reason: string }, context);
    case "missing_info":
      return runMissingInfo(input as { reason: string }, context);
    default:
      // Native function-calling is supposed to constrain the model to exact
      // registered tool names, but some models (deepseek included) have been
      // observed hallucinating a close-but-wrong name (e.g. "get_current_dates"
      // for "get_current_date") anyway. Returns a recoverable error instead of
      // throwing — throwing here would crash the whole Inngest step with no
      // reply sent to the guest at all — so the model sees the error and can
      // retry with a real tool name in the same turn.
      return {
        error: `Unknown tool name: "${toolName}". Valid tools are: ${Object.keys(tools).join(", ")}.`,
      };
  }
}

// Batches every tool call's output from a round into a single "tool" role
// message with one content part per call, matching the shape AI SDK itself
// would produce for a multi-call step.
function toolResultMessage(calls: ModelTurnResult["toolCalls"], outputs: unknown[]): ModelMessage {
  return {
    role: "tool",
    content: calls.map((call, i) => ({
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: "json", value: outputs[i] as JSONValue },
    })),
  };
}

// Enforces the prompt's "no em dash"/"no bold" rules in code, since the
// model doesn't reliably follow them on its own. Keeps the wrapped text,
// only strips the markers — "**Hairdryer**"/"*Hairdryer*" both become
// "Hairdryer".
export function sanitizeReplyText(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

export interface RunAgentTurnInput {
  conversationId: string;
  phone: string;
  incomingMessage: string;
}

export interface RunAgentTurnConfig {
  // This turn's inbound whatsapp_messages row id, passed to the
  // model-driven wants_human/missing_info tools' ToolContext (see
  // requestOwnerNudge in owner-nudge.ts).
  triggerMessageId?: string;
  // This run's correlation id — see GuestTurnRequestedEventData below for
  // where it comes from and why.
  correlationId: string;
  // The webhook route's real trace root, threaded through so this turn's own
  // "braintrust.guest_turn" marker span parents to something real instead of
  // a synthetic stand-in — see GuestTurnRequestedEventData.traceAnchor and
  // src/lib/tracing.ts's startTraceRoot/TraceAnchor.
  traceAnchor: TraceAnchor;
  // This run's Inngest step tools, threaded down explicitly since Inngest
  // (unlike DBOS) has no ambient "current workflow" equivalent to read from.
  step: GetStepTools<typeof inngest>;
}

export interface RunAgentTurnResult {
  messages: ModelMessage[];
  stepCount: number;
  // The real OTel SDK-generated id of this turn's "braintrust.guest_turn"
  // root marker span (see the "start-trace" step below) — threaded out so
  // runGuestTurn can retroactively patch that span's input/output via
  // updateSpanIO once the final reply text actually exists (see the
  // "update-turn-trace-io" step there).
  guestTurnSpanId: string;
  // Tool names dispatched from SELF_STEPPED_TOOLS this turn (wants_human,
  // missing_info, send_booking_link). All three now get their own
  // gen_ai.tool.* execution span too, unconditionally (wants_human's via
  // dispatchWantsHuman's own steppedSpan; missing_info's via runMissingInfo's
  // own steppedSpan; send_booking_link's via dispatchGatedToolCall's own
  // steppedSpan — created in this file, before requestApprovalGate ever
  // runs, not inside approval-gate.ts, which only creates that span's own
  // nudge/decision/timeout children), so none of the three strictly needs to
  // ride along in firedTags too — but all three are dispatched via
  // this same SELF_STEPPED_TOOLS branch below, which pushes every
  // self-stepped tool name in on dispatch (approved/rejected/timed-out — see
  // the branch's own comment), so they end up here as a harmless natural side
  // effect rather than something worth special-casing out. Threaded out
  // instead so runGuestTurn can pass it to updateSpanIO's merge-patch on the
  // "braintrust.guest_turn" root span, the same deferred route
  // guestTurnSpanId already uses for output.
  firedTags: string[];
}

// Runs one full guest turn: loads context, then loops model -> tools ->
// model until a final text reply, or the step cap is hit.
//
// After ANY tool call, including missing_info (which genuinely suspends via
// step.waitForEvent until the owner replies or times out — this function
// runs inside a run-guest-turn Inngest function, see runGuestTurn below),
// the loop goes back to the model for a real final reply.
export async function runAgentTurn(
  input: RunAgentTurnInput,
  config: RunAgentTurnConfig,
): Promise<RunAgentTurnResult> {
  const { conversationId, phone } = input;
  const { triggerMessageId, correlationId, traceAnchor, step } = config;

  // Lightweight marker span, once per turn, memoized in its own step — gives
  // every trace a clean root node in Braintrust's UI (attributes: conversation
  // id, phone) even though it's a near-zero-duration marker, not a span that
  // stays open for the whole turn (see src/lib/tracing.ts — no live Span
  // object can survive across Inngest step boundaries, so there's no real
  // "root span" to hold open here).
  // Real (OTel SDK-generated) span id of this marker span, captured so it
  // can be retroactively patched with the turn's real input/output once the
  // final reply exists — see updateSpanIO's own comment (src/lib/tracing.ts)
  // and the "update-turn-trace-io" step in runGuestTurn below.
  const guestTurnSpanId = await steppedSpan(
    step,
    "start-trace",
    traceAnchor,
    // Must start with one of @braintrust/otel's AISpanProcessor
    // FILTER_PREFIXES ("gen_ai."/"llm."/"ai."/"braintrust."/"traceloop.",
    // checked against the span name AND non-system attribute keys — see
    // node_modules/@braintrust/otel/dist/index.js's isAISpan) or
    // filterAISpans: true (instrumentation.ts) silently drops this span
    // before export. Neither "guest-turn" nor this span's own attributes
    // (gca.conversation_id/gca.phone) matched any prefix, which is why it
    // never showed up in Braintrust at all. "braintrust." is an honest
    // prefix for this — it's a Braintrust-observability-specific marker
    // span, not a real gen_ai call.
    "braintrust.guest_turn",
    { "gca.conversation_id": conversationId, "gca.phone": phone },
    async (span) => span.spanContext().spanId,
  );

  // Every span from here on nests under the real "braintrust.guest_turn"
  // span above, instead of parenting to traceAnchor (the webhook's root)
  // directly — that's what gives load-memory/load-system-prompt/gen_ai.*/
  // etc. proper parent/child structure in Braintrust and Axiom, rather than
  // all landing as siblings of braintrust.guest_turn. traceId never changes
  // within a turn, only which real span is "current".
  const turnAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: guestTurnSpanId };

  const toolContext: ToolContext = {
    conversationId,
    phone,
    triggerMessageId,
    correlationId,
    traceAnchor: turnAnchor,
    step,
  };

  // Cast needed — see steppedSpan's doc comment in tracing.ts for why
  // step.run()'s return type gets narrowed at all. loadMemory's
  // historyMessages is a ModelMessage[] built from plain DB rows via
  // toModelMessage() in memory.ts — always user/assistant text content,
  // never a file part — so the narrowing is a false positive here.
  const { historyMessages, memoryMessage } = (await steppedSpan(
    step,
    "load-memory",
    turnAnchor,
    "load-memory",
    { "gca.conversation_id": conversationId },
    () => loadMemory({ conversationId, phone }),
  )) as AgentMemory;
  // historyMessages already ends with this turn's incoming guest message:
  // the webhook route (route.ts) records it to whatsapp_messages BEFORE
  // enqueuing the turn, so loadRecentMessages (oldest-first) always returns
  // it as the last row by the time this runs. Appending incomingMessage
  // again here used to duplicate it as two consecutive identical user
  // messages in every gen_ai.input.messages payload.
  //
  // memoryMessage (guest preferences + the one recent fold, if either
  // exists — see memory.ts's buildMemoryMessage) is prepended ahead of
  // historyMessages as its own message, not substituted into `system`
  // below — see loadSystemPromptText's own comment. Omitted entirely
  // (rather than an empty placeholder) when loadMemory found nothing to say.
  let messages: ModelMessage[] = memoryMessage
    ? [memoryMessage, ...historyMessages]
    : historyMessages;

  // Hoisted out of the loop and fetched exactly once per turn, not once per
  // round: the system prompt text doesn't change across rounds of the same
  // turn. Un-stepped code between step.run checkpoints re-runs on every
  // Inngest replay — left inside the loop, a replay reaching round N would
  // re-fetch the Braintrust prompt for every round 1..N that already ran
  // (wasted API calls).
  //
  // No guest-memory template variable passed to build() anymore — guest
  // memory now reaches the model as memoryMessage, its own entry in
  // `messages` above, not template-substituted into the system string. The
  // corresponding {{guest_memory_block}} slot has already been removed from
  // the live gca-system prompt directly (published outside this repo, not
  // through a staged-draft review file here) — build({}) is a plain empty
  // call today, not a shim for a lagging prompt.
  async function loadSystemPromptText(): Promise<string> {
    const promptTemplate = await loadPrompt({
      projectId: process.env.BRAINTRUST_PROJECT_ID,
      slug: SYSTEM_PROMPT_SLUG,
      defaults: { model: MODEL },
    });
    const { messages } = promptTemplate.build({});
    return messages[0].content as string;
  }

  // Cast needed — see steppedSpan's doc comment in tracing.ts for why
  // step.run()'s return type gets narrowed at all. The system prompt here
  // is always a plain string, so the narrowing is a false positive for this
  // call site.
  const system = (await steppedSpan(
    step,
    "load-system-prompt",
    turnAnchor,
    "load-system-prompt",
    {},
    loadSystemPromptText,
  )) as string;

  let stepCount = 0;

  // Accumulates across rounds exactly like `messages` above: rebuilt from
  // already-completed/memoized step results on every Inngest replay, so it
  // reconstructs identically each pass rather than drifting. See
  // RunAgentTurnResult.firedTags for why this exists.
  const firedTags: string[] = [];

  while (stepCount < MAX_AGENT_STEPS) {
    stepCount++;

    // Cast needed — see steppedSpan's doc comment in tracing.ts for why
    // step.run()'s return type gets narrowed at all (this call uses raw
    // step.run, not steppedSpan, since modelTurn already opens its own
    // withTurnSpan internally — same cast concern either way). GCA's
    // ModelMessage content here is always plain text/tool-call parts — this
    // agent never sends or receives file attachments — so the narrowing is
    // a false positive for this call site specifically.
    const result = (await step.run(`model-${stepCount}`, () =>
      modelTurn(system, messages, turnAnchor),
    )) as ModelTurnResult;

    if (result.toolCalls.length === 0) {
      const replyText =
        result.text.trim() === "" ? FALLBACK_REPLY_TEXT : sanitizeReplyText(result.text);
      messages = [...messages, { role: "assistant", content: replyText }];
      return { messages, stepCount, guestTurnSpanId, firedTags };
    }

    // No tool has `execute`, so we dispatch and build the tool-result
    // message ourselves; a rejected APPROVAL_GATES call never reaches
    // runToolCall.
    const toolOutputs = await Promise.all(
      result.toolCalls.map(async (call) => {
        // See SELF_STEPPED_TOOLS above for why wants_human/missing_info/
        // send_booking_link are dispatched directly here instead of wrapped in
        // step.run. Concretely: this branch (like the rest of the loop body)
        // re-executes on every Inngest replay, so tracing it here would
        // duplicate-emit a span every time the function replays after a
        // suspend (missing_info's up-to-24h and send_booking_link's
        // effectively-forever step.waitForEvent waits — the latter now
        // inside approval-gate.ts's requestApprovalGate — are exactly the
        // highest-value case this would corrupt). Every other tool IS
        // already inside step.run(`tool-${call.toolName}`, ...) below, which
        // Inngest only actually executes once — replays return the memoized
        // value without re-running the callback — so wrapping the
        // runToolCall call inside it there is replay-safe.
        if (SELF_STEPPED_TOOLS.has(call.toolName)) {
          // The gating check itself: only tools with an APPROVAL_GATES entry
          // (send_booking_link today) go through dispatchGatedToolCall at all —
          // wants_human/missing_info have no entry (see APPROVAL_GATES'
          // comment) and fall straight through to runToolCall below.
          const gate = APPROVAL_GATES[call.toolName];
          if (gate) {
            const output = await dispatchGatedToolCall(call, gate, correlationId, toolContext);
            // See RunAgentTurnResult.firedTags for why this is collected
            // here rather than as a span attribute — pushed regardless of
            // the gate's outcome (approved/rejected/timed out all still
            // count as "this tool was attempted this turn").
            firedTags.push(call.toolName);
            return output;
          }

          const output = await runToolCall(call.toolName, call.input, toolContext);
          // See RunAgentTurnResult.firedTags for why this is collected here
          // rather than as a span attribute.
          firedTags.push(call.toolName);
          return output;
        }

        // Every other tool (not self-stepped, not gated): dispatchToolExecution
        // gives it the same gen_ai.tool.* execution span shape as the gated/
        // wants_human call sites above. send_booking_link never reaches this
        // branch (see SELF_STEPPED_TOOLS above) — its "braintrust.tags"
        // tagging happens inside approval-gate.ts's requestApprovalGate span
        // instead.
        return await steppedSpan(
          step,
          `tool-${call.toolName}`,
          turnAnchor,
          `gen_ai.tool.${call.toolName}`,
          { "gen_ai.tool.name": call.toolName, "gen_ai.operation.name": "execute_tool" },
          (span) =>
            dispatchToolExecution(span, call.input, () =>
              runToolCall(call.toolName, call.input, toolContext),
            ),
        );
      }),
    );
    messages = [
      ...messages,
      ...result.response.messages,
      toolResultMessage(result.toolCalls, toolOutputs),
    ];
  }

  return { messages, stepCount, guestTurnSpanId, firedTags };
}

// The event that triggers a guest turn — sent (fire-and-forget) by the
// webhook route, consumed by runGuestTurnFunction below.
export const GUEST_TURN_REQUESTED_EVENT = "gca/guest-turn.requested";

interface GuestTurnRequestedEventData {
  // Which conversation this turn belongs to (conversations table row id).
  conversationId: string;
  // Guest's WhatsApp number, normalized (no "whatsapp:" prefix).
  phone: string;
  // The guest's message text — the actual content, not an id.
  incomingMessage: string;
  // Row id of the guest's inbound message in whatsapp_messages. Not always
  // set — only real webhook calls have one.
  triggerMessageId?: string;
  // Random id for this run, set once in the webhook route (before any
  // request validation — see that route's own comment). Lets
  // step.waitForEvent (see missing-info.ts) find this exact suspended run
  // when the owner's reply comes back as a separate event. Used only for
  // that event match, not for tracing — traceAnchor below carries the trace
  // context.
  correlationId: string;
  // The webhook route's real trace root (src/lib/tracing.ts's
  // startTraceRoot), captured once, before any request validation, from the
  // "webhook.verify_signature" span. Every withTurnSpan call for this turn,
  // from the webhook route's own remaining pre-Inngest stages through to the
  // final reply send, parents to this (or to a real span descended from it —
  // see runAgentTurn's own turnAnchor), so the whole interaction lands as one
  // properly nested trace instead of a flat list of spans sharing a
  // synthetic, never-emitted parent.
  traceAnchor: TraceAnchor;
}

export interface RunGuestTurnParams extends GuestTurnRequestedEventData {
  step: GetStepTools<typeof inngest>;
}

// Delivery orchestrator: drives the real runAgentTurn, then records the
// reply and sends it proactively. By the time this function reaches those
// side effects — whether 200ms or, after a real missing_info suspend, hours
// later — the original inbound Twilio HTTP request has already returned its
// empty TwiML ack, so every guest-facing reply is delivered proactively now.
//
// Kept as a plain function (not the inngest.createFunction() call itself)
// so tests can call it directly with a hand-rolled `step` mock instead of
// spinning up a real Inngest engine — see runGuestTurnFunction below for the
// thin adapter that actually gets registered with Inngest.
export async function runGuestTurn(params: RunGuestTurnParams): Promise<void> {
  const {
    conversationId,
    phone,
    incomingMessage,
    triggerMessageId,
    correlationId,
    traceAnchor,
    step,
  } = params;

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    { triggerMessageId, correlationId, traceAnchor, step },
  );

  // Deliberately back at traceAnchor (the webhook's "webhook.turn" root),
  // NOT nested under "braintrust.guest_turn" (unlike runAgentTurn's own
  // turnAnchor, scoped to just its model/tool-call spans) — these three
  // spans are delivery/bookkeeping that happens after the guest turn's own
  // reasoning is done, not part of it, so they sit as its siblings.
  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : FALLBACK_REPLY_TEXT;

  // Retroactive merge-patch: the "braintrust.guest_turn" root marker span
  // (started/closed empty in the "start-trace" step, well before replyText
  // exists) is what the Traces LIST view surfaces Input/Output from. Plain
  // strings here, not JSON-stringified — unlike the child spans' structured
  // message arrays (which must fit as OTel span attributes), this goes
  // through updateSpanIO's REST call directly, and plain strings render most
  // cleanly in Braintrust's UI.
  //
  // Deduped: a single turn can plausibly call missing_info more than once
  // across rounds (each dispatch pushes into firedTags), but Braintrust's
  // tags field is a set, not a multiset — duplicate entries add nothing.
  const dedupedTags = [...new Set(result.firedTags)];
  await steppedSpan(step, "update-turn-trace-io", traceAnchor, "update-turn-trace-io", {}, () =>
    updateSpanIO(result.guestTurnSpanId, {
      input: incomingMessage,
      output: replyText,
      ...(dedupedTags.length > 0 ? { tags: dedupedTags } : {}),
    }),
  );

  // Captured so the delivery-status update below can target this exact row
  // by id — recordMessage's return value is that row's real id (see its own
  // doc comment in conversations.ts).
  const replyMessageId = await steppedSpan(
    step,
    "record-reply",
    traceAnchor,
    "record-reply",
    { "gca.conversation_id": conversationId },
    () =>
      // traceAnchor.traceId is a real OTel trace id (see
      // src/lib/tracing.ts's startTraceRoot) shared by every span emitted
      // for this turn, so this DB value doubles as a working pointer into
      // Braintrust/Axiom for this turn.
      recordMessage(conversationId, "assistant", replyText, traceAnchor.traceId),
  );

  async function sendGuestWhatsAppReply(span: Span) {
    const sendResult = await sendWhatsAppMessage(phone, replyText);
    if (!sendResult.ok) {
      console.error(`[run-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`);
      markSpanFailed(span, sendResult.error ?? "sendWhatsAppMessage failed with no error message");
    }
    return sendResult;
  }

  const sendResult = await steppedSpan(
    step,
    "send-whatsapp-reply",
    traceAnchor,
    "send-whatsapp-reply",
    { "gca.phone": phone },
    sendGuestWhatsAppReply,
  );

  // Own step, distinct from record-reply above — persists the one thing that
  // wasn't known yet when that row was inserted (whether the send actually
  // landed), so an admin recovery UI can later find/retry a reply that was
  // generated but never delivered (see the delivery_status column's own
  // migration comment).
  await step.run("update-message-delivery-status", () =>
    updateMessageDeliveryStatus(replyMessageId, sendResult.ok ? "sent" : "failed"),
  );

  // Folds whatever this turn dropped out of the trimmed history window
  // (including, now, this turn's own just-recorded assistant reply) into
  // guest_memory's rolling summary — the same summarize-and-persist side
  // effect loadMemory used to do inline before the model call, moved here so
  // its LLM round-trip (24-43s in real traces) no longer sits on the guest's
  // reply-latency critical path. Parented to traceAnchor (webhook root),
  // like its record-reply/send-whatsapp-reply siblings above, not to
  // turnAnchor/"braintrust.guest_turn" — that span has already closed by the
  // time this runs (see runAgentTurn's own turnAnchor comment for why those
  // three are siblings, not children, of the guest turn's own reasoning
  // span). foldMemory's own summarizeConversation call opens its
  // "gen_ai.chat" span under whatever anchor it's given, so passing this
  // step's own real span id (not traceAnchor itself) below is what nests
  // that call under "fold-memory-summary" instead of directly under the
  // webhook root.
  async function foldGuestMemory(span: Span): Promise<void> {
    try {
      await foldMemory({
        conversationId,
        phone,
        traceAnchor: { traceId: traceAnchor.traceId, spanId: span.spanContext().spanId },
      });
    } catch (err) {
      // Same soft-fail spirit as sendGuestWhatsAppReply above: the guest
      // already has their reply by this point, so a summarization failure
      // must never crash an otherwise-successful turn. Safe to just log +
      // mark the span failed — the existing watermark mechanism (see
      // memory.ts's loadMemoryState) makes a lost fold harmless regardless,
      // the next turn's fold just sees a bigger backlog.
      console.error(`[run-turn] foldMemory failed for conversation ${conversationId}:`, err);
      markSpanFailed(span, err);
      Sentry.captureException(err);
    }
  }

  await steppedSpan(
    step,
    "fold-memory-summary",
    traceAnchor,
    "fold-memory-summary",
    { "gca.conversation_id": conversationId },
    foldGuestMemory,
  );
}

// The Inngest function actually registered with /api/inngest (see
// src/app/api/inngest/route.ts). Thin adapter: pulls the typed payload off
// the triggering event and hands it, plus this run's own step tools, to the
// plain runGuestTurn above.
export const runGuestTurnFunction = inngest.createFunction(
  { id: "run-guest-turn", triggers: [{ event: GUEST_TURN_REQUESTED_EVENT }] },
  async ({ event, step }) => {
    const data = event.data as GuestTurnRequestedEventData;
    await runGuestTurn({ ...data, step });
  },
);
