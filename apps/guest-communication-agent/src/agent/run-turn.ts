import type { Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import { generateText, type JSONValue, type ModelMessage } from "ai";
import { loadPrompt } from "braintrust";
import type { GetStepTools } from "inngest";
import { type AgentMemory, foldMemory, loadMemory } from "@/agent/memory";
import { dispatchToolExecution, runTool, tools } from "@/agent/run-tool";
import { requestApprovalGate } from "@/agent/tools/approval-gate";
import { flushTracing } from "@/instrumentation";
import {
  BOOKING_LINK_APPROVAL_EVENT,
  BOOKING_LINK_APPROVAL_TIMEOUT,
  buildBookingApprovalReason,
} from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { type OwnerNudgeReason } from "@/agent/tools/owner-nudge";
import { recordMessage, updateMessageDeliveryStatus } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
import {
  markSpanFailed,
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

// RULE: most tool files (src/agent/tools/*.ts) stay pure — no step/span/
// Inngest imports; all durability/tracing plumbing belongs here, in
// run-tool.ts (the tool registry + generic dispatcher this file calls into),
// or in approval-gate.ts's shared gate. booking.ts is the model for what
// "pure" looks like. Two kinds of
// deliberate exception exist: a plain OTel span with zero step/Inngest
// coupling (property-question.ts's own DB-call span, owner-nudge.ts's send
// span) — not durability plumbing, just tracing; and a tool whose own
// dispatch genuinely needs real Inngest step/waitForEvent semantics
// (wants-human.ts's own runWantsHuman, missing-info.ts's own runMissingInfo)
// — that plumbing lives inside the tool's own run<ToolName>, per this app's
// run<ToolName> convention, not here. If you're adding either kind, ask
// whether it's genuinely the same case before treating it as precedent.

// Tools whose dispatch itself calls step.run/step.waitForEvent — wants_human
// via wants-human.ts's own runWantsHuman, missing_info via missing-info.ts's
// own runMissingInfo, send_booking_link via this file's own private
// dispatchGatedToolCall (which also calls into approval-gate.ts's
// requestApprovalGate for any APPROVAL_GATES-gated tool, send_booking_link
// today) — see the "tool files stay pure" rule above for the two kinds of
// exception this covers. Inngest
// doesn't support calling a step tool from inside another step.run()'s
// callback — the callback must be a self-contained unit of work — so
// wants_human, missing_info, and send_booking_link are all dispatched
// directly from the loop below (never wrapped in an outer step.run). Every
// other tool has no step usage of its own, so wrapping the whole call in one
// step.run is safe and gives it real memoization/replay safety.
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
    // experimental_telemetry (the AI SDK's own OTel instrumentation, via the
    // same globally-registered tracer instrumentation.ts sets up) auto-emits
    // ai.generateText/ai.generateText.doGenerate child spans whose Input/
    // Output/usage Braintrust already renders correctly on its own — unlike
    // this app's own gen_ai.* attributes below, no braintrust.* duplication
    // needed for these child spans. metadata.gca.attempt reads `attempt`
    // live at each call, so it reflects the actual retry attempt per span.
    const callModel = () =>
      generateText({
        model,
        system,
        messages,
        tools,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "gca.model_turn",
          metadata: { "gca.attempt": attempt },
        },
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

// APPROVAL_GATES-gated dispatch (send_booking_link today, any future gated
// tool tomorrow): creates the real gen_ai.tool.<name> execution span FIRST —
// before requestApprovalGate ever runs — with the model's real tool-call
// `input` set at creation, same shape wants-human.ts's own runWantsHuman/
// missing-info.ts's own runMissingInfo give their own tool spans. Only
// `fn`'s return value (the real OTel-generated span id) survives this step —
// same pattern those two functions' own toolSpanId uses, for the same reason
// (no live Span object survives an Inngest step boundary). That id becomes a
// new toolAnchor, passed to requestApprovalGate as its own traceAnchor
// param, so the nudge/decision/timeout spans requestApprovalGate creates
// internally become this tool-call span's real children instead of siblings
// of the turn's own anchor — the same reparenting missing-info.ts's own
// runMissingInfo gets for owner_nudge.missing_info/missing_info.no_reply
// relative to gen_ai.tool.missing_info, just crossing into
// approval-gate.ts's shared mechanism instead of being entirely local to
// this file.
//
// Every outcome funnels into one updateSpanIO patch on toolSpanId, unlike
// the pre-fix behavior where only the approved path ever got an execution
// span at all: a rejected/timed-out call patches the same not-approved shape
// already returned to the model; an approved call patches the real
// execution result. Private: only called from the loop's SELF_STEPPED_TOOLS
// branch below, never nested inside another step.run — safe to call from
// there because, like wants-human.ts's own runWantsHuman/missing-info.ts's
// own runMissingInfo, this function calls step.run/requestApprovalGate
// itself rather than being called from inside one (see SELF_STEPPED_TOOLS's
// own comment for why that nesting is unsafe).
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
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands before either of this
  // function's later updateSpanIO patches (the not-approved path or the
  // executed-result path below) can fire and race it. See wants-human.ts's
  // own runWantsHuman's identical flushTracing() call for the full
  // reasoning; one flush here covers both later patch paths.
  await flushTracing();
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
    runTool(call.toolName, call.input, context),
  );
  await step.run(`update-${call.toolName}-trace-io`, () => updateSpanIO(toolSpanId, { output }));
  return output;
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
  // root marker span (see the "start-trace" step below) — threaded out for
  // any caller that needs to identify this turn's root span directly. Final
  // input/output land on a separate sibling span ("update-turn-trace-io"
  // below) instead of being patched onto this one — see that step's own
  // comment.
  guestTurnSpanId: string;
  // Tool names dispatched from SELF_STEPPED_TOOLS this turn (wants_human,
  // missing_info, send_booking_link). All three now get their own
  // gen_ai.tool.* execution span too, unconditionally (wants_human's via
  // wants-human.ts's own runWantsHuman's steppedSpan; missing_info's via
  // missing-info.ts's own runMissingInfo's steppedSpan; send_booking_link's
  // via dispatchGatedToolCall's own steppedSpan — created in this file,
  // before requestApprovalGate ever runs, not inside approval-gate.ts, which
  // only creates that span's own
  // nudge/decision/timeout children), so none of the three strictly needs to
  // ride along in firedTags too — but all three are dispatched via
  // this same SELF_STEPPED_TOOLS branch below, which pushes every
  // self-stepped tool name in on dispatch (approved/rejected/timed-out — see
  // the branch's own comment), so they end up here as a harmless natural side
  // effect rather than something worth special-casing out. Threaded out so
  // runGuestTurn can attach these tags to the "update-turn-trace-io" result
  // span alongside the final input/output.
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
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands before runGuestTurn's later
  // "update-turn-trace-io" updateSpanIO patch can fire and race it. Without
  // this happens-before, whichever write lands last wins: the OTel export
  // carries neither input nor output for this marker span (only
  // gca.conversation_id/gca.phone), so it can silently wipe the patch back
  // to null if it lands second — confirmed happening in practice via this
  // span's own Braintrust audit_data trail. See wants-human.ts's own
  // runWantsHuman's identical flushTracing() call for the same reasoning
  // applied to a tool-call span instead of this turn-level marker.
  await flushTracing();

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
    // run-tool.ts's runTool.
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
        // value without re-running the callback — so wrapping the runTool
        // call inside it there is replay-safe.
        if (SELF_STEPPED_TOOLS.has(call.toolName)) {
          // The gating check itself: only tools with an APPROVAL_GATES entry
          // (send_booking_link today) go through dispatchGatedToolCall at all —
          // wants_human/missing_info have no entry (see APPROVAL_GATES'
          // comment) and fall straight through to runTool below.
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

          const output = await runTool(call.toolName, call.input, toolContext);
          // See RunAgentTurnResult.firedTags for why this is collected here
          // rather than as a span attribute.
          firedTags.push(call.toolName);
          return output;
        }

        // Every other tool (not self-stepped, not gated): dispatchToolExecution
        // (run-tool.ts) gives it the same gen_ai.tool.* execution span shape as
        // the gated/wants_human call sites above. send_booking_link never
        // reaches this branch (see SELF_STEPPED_TOOLS above) — its
        // "braintrust.tags" tagging happens inside approval-gate.ts's
        // requestApprovalGate span instead.
        async function dispatchGenericTool(span: Span): Promise<unknown> {
          return dispatchToolExecution(span, call.input, () =>
            runTool(call.toolName, call.input, toolContext),
          );
        }

        return await steppedSpan(
          step,
          `tool-${call.toolName}`,
          turnAnchor,
          `gen_ai.tool.${call.toolName}`,
          { "gen_ai.tool.name": call.toolName, "gen_ai.operation.name": "execute_tool" },
          dispatchGenericTool,
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

  // A real, single-write span instead of a retroactive patch on the
  // "braintrust.guest_turn" root marker (started/closed empty in the
  // "start-trace" step): that marker's own OTel export and a later
  // updateSpanIO patch on it are two independent writers racing on the same
  // Braintrust row, and Braintrust's OTLP ingestion is asynchronous on their
  // backend — no client-side await ordering can guarantee which one lands
  // last (confirmed empirically; see updateSpanIO's own doc comment in
  // tracing.ts). This span sidesteps the race entirely: input/output are
  // already known here, so they're set as real attributes at creation time,
  // one export, nothing else ever touches this row. It's a sibling of
  // "braintrust.guest_turn" (same reasoning as the comment above), not a
  // patch on it. Plain strings, not JSON-stringified — unlike the child
  // spans' structured message arrays (which must fit as OTel span
  // attributes), plain strings render most cleanly in Braintrust's UI. The
  // online-scoring automation targets this span's name directly.
  //
  // Deduped: a single turn can plausibly call missing_info more than once
  // across rounds (each dispatch pushes into firedTags), but Braintrust's
  // tags field is a set, not a multiset — duplicate entries add nothing.
  const dedupedTags = [...new Set(result.firedTags)];
  await steppedSpan(
    step,
    "update-turn-trace-io",
    traceAnchor,
    "braintrust.guest_turn.result",
    {
      "braintrust.input": incomingMessage,
      "braintrust.output": replyText,
      ...(dedupedTags.length > 0 ? { "braintrust.tags": dedupedTags } : {}),
    },
    async () => {},
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
