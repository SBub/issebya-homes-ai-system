import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { loadPrompt } from "braintrust";
import type { GetStepTools } from "inngest";
import { type AgentMemory, loadMemory } from "@/agent/memory";
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
import { missingInfo, runMissingInfo } from "@/agent/tools/missing-info";
import type { OwnerNudgeReason } from "@/agent/tools/owner-nudge";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runCode, runRunCode } from "@/agent/tools/run-code";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { recordMessage } from "@/lib/conversations";
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
// SYSTEM_PROMPT_VERSION_OVERRIDE pins an exact version instead, for CI eval
// jobs that need a fixed prompt regardless of whatever's currently saved —
// must never be set in a real runtime environment.
const SYSTEM_PROMPT_SLUG = "gca-system";
const SYSTEM_PROMPT_VERSION_OVERRIDE = process.env.SYSTEM_PROMPT_VERSION_OVERRIDE;

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

// Schema-only tool declarations — dispatch happens manually in runToolCall()
// below. The owner-nudge tools' keys are the literal snake_case tool names
// the model sees (deliberately unlike the camelCase tools here).
const tools = {
  getPricing,
  checkAvailability,
  answerPropertyQuestion,
  sendBookingLink,
  getCurrentDate,
  runCode,
  wants_human: wantsHuman,
  missing_info: missingInfo,
} satisfies ToolSet;

// Tools whose own dispatch calls step.waitForEvent (directly, or indirectly
// via approval-gate.ts's requestApprovalGate) to suspend: missing_info's
// waitForMissingInfoReply, and sendBookingLink via the APPROVAL_GATES check
// below. Inngest doesn't support calling a step tool from inside another
// step.run()'s callback — the callback must be a self-contained unit of
// work — so wants_human, missing_info, and sendBookingLink are all
// dispatched directly from the loop below (never wrapped in an outer
// step.run) and manage their own checkpointing internally where they have
// any (wants_human currently has none of its own — it's grouped here for
// the same "never nest inside an outer step.run" reasoning, not because it
// calls step itself today). Every other tool has no step usage of its own,
// so wrapping the whole call in one step.run is safe and gives it real
// memoization/replay safety.
const SELF_STEPPED_TOOLS = new Set(["wants_human", "missing_info", "sendBookingLink"]);

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
const APPROVAL_GATES: Partial<
  Record<
    string,
    {
      reasonCategory: OwnerNudgeReason;
      buildReason: (input: Record<string, unknown>) => string;
      event: string;
      timeout: string;
    }
  >
> = {
  sendBookingLink: {
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
  return withTurnSpan(
    turnAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    async (span) => {
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
    },
  );
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
    case "getPricing":
      return runGetPricing(input as Parameters<typeof runGetPricing>[0]);
    case "checkAvailability":
      return runCheckAvailability(input as Parameters<typeof runCheckAvailability>[0]);
    case "answerPropertyQuestion":
      return runAnswerPropertyQuestion(input as Parameters<typeof runAnswerPropertyQuestion>[0]);
    case "sendBookingLink":
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0]);
    case "getCurrentDate":
      return runGetCurrentDate();
    case "runCode":
      return runRunCode(input as Parameters<typeof runRunCode>[0]);
    case "wants_human":
      return runWantsHuman(input as Parameters<typeof runWantsHuman>[0], context);
    case "missing_info":
      return runMissingInfo(input as Parameters<typeof runMissingInfo>[0], context);
    default:
      // Native function-calling is supposed to constrain the model to exact
      // registered tool names, but some models (deepseek included) have been
      // observed hallucinating a close-but-wrong name (e.g. "getCurrentDates"
      // for "getCurrentDate") anyway. Returns a recoverable error instead of
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
  // missing_info, sendBookingLink) — exists because wants_human/missing_info
  // never get a span of their own (see SELF_STEPPED_TOOLS's comment), so
  // there's nowhere to set a braintrust.tags attribute directly for them
  // (braintrust.tags aggregates up to the whole trace from any span — see
  // tracing.ts's withTurnSpan doc comment). sendBookingLink DOES get its own
  // span now (inside
  // approval-gate.ts's requestApprovalGate, tagged there directly), so it
  // doesn't strictly need to ride along in firedTags too — but it's
  // dispatched via this same SELF_STEPPED_TOOLS branch below, which pushes
  // every self-stepped tool name in on dispatch (approved or rejected — see
  // the branch's own comment), so it ends up here as a harmless natural side
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
  const { conversationId, phone, incomingMessage } = input;
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
  const { historyMessages, contextBlock } = (await steppedSpan(
    step,
    "load-memory",
    turnAnchor,
    "load-memory",
    { "gca.conversation_id": conversationId },
    () => loadMemory({ conversationId, phone, traceAnchor: turnAnchor }),
  )) as AgentMemory;
  let messages: ModelMessage[] = [...historyMessages, { role: "user", content: incomingMessage }];

  // Hoisted out of the loop and fetched exactly once per turn, not once per
  // round: contextBlock (loaded above, once, from load-memory) doesn't
  // change across rounds of the same turn, so neither does the system string
  // derived from it. Un-stepped code between step.run checkpoints re-runs on
  // every Inngest replay — left inside the loop, a replay reaching round N
  // would re-fetch the Braintrust prompt for every round 1..N that already
  // ran (wasted API calls).
  //
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
    async () => {
      const promptTemplate = await loadPrompt({
        projectId: process.env.BRAINTRUST_PROJECT_ID,
        slug: SYSTEM_PROMPT_SLUG,
        ...(SYSTEM_PROMPT_VERSION_OVERRIDE ? { version: SYSTEM_PROMPT_VERSION_OVERRIDE } : {}),
      });
      const { messages } = promptTemplate.build({ guest_memory_block: contextBlock });
      return messages[0].content as string;
    },
  )) as string;

  console.log("contextBlock", contextBlock);

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
        // sendBookingLink are dispatched directly here instead of wrapped in
        // step.run. Concretely: this branch (like the rest of the loop body)
        // re-executes on every Inngest replay, so tracing it here would
        // duplicate-emit a span every time the function replays after a
        // suspend (missing_info's up-to-24h and sendBookingLink's
        // effectively-forever step.waitForEvent waits — the latter now
        // inside approval-gate.ts's requestApprovalGate — are exactly the
        // highest-value case this would corrupt). Every other tool IS
        // already inside step.run(`tool-${call.toolName}`, ...) below, which
        // Inngest only actually executes once — replays return the memoized
        // value without re-running the callback — so wrapping the
        // runToolCall call inside it there is replay-safe.
        if (SELF_STEPPED_TOOLS.has(call.toolName)) {
          // The gating check itself: only tools with an APPROVAL_GATES entry
          // (sendBookingLink today) go through requestApprovalGate at all —
          // wants_human/missing_info have no entry (see APPROVAL_GATES'
          // comment) and fall straight through to runToolCall below.
          const gate = APPROVAL_GATES[call.toolName];
          if (gate) {
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
              traceAnchor: turnAnchor,
            });
            if (!approved) {
              // Same shape a rejected/timed-out gate has always returned to
              // the model. Pushed into firedTags here too (rather than only
              // on the approved path below) — a gated call that got a real
              // nudge sent and a real decision made is still worth being
              // able to find in this turn's trace tags.
              firedTags.push(call.toolName);
              return {
                approved: false,
                message: "This action was not approved. Do not retry it automatically.",
              };
            }
          }

          const output = await runToolCall(call.toolName, call.input, toolContext);
          // See RunAgentTurnResult.firedTags for why this is collected here
          // rather than as a span attribute.
          firedTags.push(call.toolName);
          return output;
        }

        return await steppedSpan(
          step,
          `tool-${call.toolName}`,
          turnAnchor,
          `gen_ai.tool.${call.toolName}`,
          { "gen_ai.tool.name": call.toolName, "gen_ai.operation.name": "execute_tool" },
          async (span) => {
            const output = await runToolCall(call.toolName, call.input, toolContext);
            span.setAttribute("gca.tool.input", JSON.stringify(call.input));
            span.setAttribute("gca.tool.output", JSON.stringify(output));
            // Same braintrust.* duplication as modelTurn above — see
            // tracing.ts's withTurnSpan doc comment for why.
            span.setAttribute("braintrust.input", JSON.stringify(call.input));
            span.setAttribute("braintrust.output", JSON.stringify(output));
            // sendBookingLink doesn't reach this generic wrapper (see
            // SELF_STEPPED_TOOLS above) — its "braintrust.tags" tagging
            // happens inside approval-gate.ts's requestApprovalGate span
            // instead.
            return output;
          },
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

  await steppedSpan(
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

  await steppedSpan(
    step,
    "send-whatsapp-reply",
    traceAnchor,
    "send-whatsapp-reply",
    { "gca.phone": phone },
    async (span) => {
      const sendResult = await sendWhatsAppMessage(phone, replyText);
      if (!sendResult.ok) {
        console.error(`[run-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`);
        markSpanFailed(
          span,
          sendResult.error ?? "sendWhatsAppMessage failed with no error message",
        );
      }
      return sendResult;
    },
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
