import type { Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";
import { type JSONValue, type ModelMessage } from "ai";
import { loadPrompt } from "braintrust";
import type { GetStepTools } from "inngest";
import { type AgentMemory, foldMemory, loadMemory } from "@/agent/memory";
import { NEEDS_APPROVAL, requestApproval, runApprovedTool, traceIoStepId } from "@/agent/run-hitl";
import { MODEL, type ModelTurnResult, runModel } from "@/agent/run-model";
import { runTool } from "@/agent/run-tool";
import { flushTracing } from "@/instrumentation";
import type { HitlDecision } from "@/agent/tools/approval-gate";
import type { ToolContext } from "@/agent/tools/config";
import { recordMessage, updateMessageDeliveryStatus } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { markSpanFailed, steppedSpan, type TraceAnchor, updateSpanIO } from "@/lib/tracing";
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
// run-model.ts's runModel's markSpanFailed call for the trace-visible side
// of this same condition), and runGuestTurn's own "no assistant message at
// all" case. Sending the model's raw "" straight to Twilio 400s (a message
// body can't be empty), which is what silently ate a guest's reply before
// this existed.
const FALLBACK_REPLY_TEXT = "Sorry, I couldn't process that — please try again shortly.";

// RULE: every tool owns its own gen_ai.tool.<name> execution span and any
// step/waitForEvent usage it needs — created inside that tool's own
// run<ToolName>, in its own file under src/agent/tools/ (this app's
// run<ToolName> convention, see wants-human.ts's runWantsHuman for the
// model every tool follows). This loop calls tools uniformly (see the
// dispatch loop below) and does no span-wrapping of its own for any of
// them — that used to live here as a generic wrapper; it's now inside each
// tool instead, so "what does this tool actually do" and "how is it traced"
// are answerable from one file per tool, not split between the tool's own
// file and this one.
//
// Two tiers of tool exist, differing only in how MUCH step/span machinery
// they need, not in whether they need any:
// - The 5 plain tools (get_pricing, check_availability,
//   answer_property_question, get_current_date, run_code) and wants_human
//   have no real side effect worth protecting across a crash-and-replay
//   beyond one atomic unit of work, so each wraps its whole logic in a
//   single steppedSpan call (see tool-execution.ts's dispatchToolExecution,
//   the shared helper the 5 plain tools call from inside that one step).
//   wants_human is the one exception in this tier that needs more than a
//   single step — see wants-human.ts's own comment for why (a real
//   Telegram send that must not double-fire on an Inngest retry needs its
//   own separately-memoized step, distinct from the span-creation and
//   output-patch steps around it).
// - missing_info and send_booking_link (run-hitl.ts's NEEDS_APPROVAL) need
//   a genuine suspend: their execution span is created BEFORE a real
//   approval wait starts (so nudge/decision/timeout spans nest under it as
//   children), and that wait can suspend for hours to up to a year
//   (send_booking_link's BOOKING_LINK_APPROVAL_TIMEOUT). No single tool call
//   can "own" a span spanning that — approval (run-hitl.ts's
//   requestApproval) and execution (run-hitl.ts's runApprovedTool) are two
//   separate, sequential steps this loop calls directly (see the
//   NEEDS_APPROVAL branch below), deliberately not bundled into one
//   function, so the approval decision and the tool call stay visibly
//   distinct here — the one remaining special case in this loop, forced by
//   the wait duration, not by choice.
//
// Inngest doesn't support calling a step tool from inside another
// step.run()'s callback — the callback must be a self-contained unit of
// work — which is why every tool dispatches its own step.run calls itself
// rather than this loop wrapping them from outside.

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
  // Deliberately narrow, not "every tool this turn used": only wants_human,
  // missing_info, and send_booking_link ever get pushed here (see the
  // dispatch loop's own push sites below) — these three are the tools worth
  // a turn-level "did this happen" signal (escalation/gating), unlike
  // get_pricing/check_availability/etc., which fire on nearly every turn and
  // would just be noise as a filterable tag. All three already get their own
  // gen_ai.tool.* execution span regardless (each tool's own run<ToolName>
  // creates it — see the "RULE" comment above), so firedTags isn't needed
  // for that; it exists purely for this narrower turn-level tagging.
  // Threaded out so runGuestTurn can attach these tags to the
  // "update-turn-trace-io" result span alongside the final input/output.
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
    // step.run, not steppedSpan, since run-model.ts's runModel already opens
    // its own withTurnSpan internally — same cast concern either way). GCA's
    // ModelMessage content here is always plain text/tool-call parts — this
    // agent never sends or receives file attachments — so the narrowing is
    // a false positive for this call site specifically.
    const result = (await step.run(`model-${stepCount}`, () =>
      runModel(system, messages, turnAnchor),
    )) as ModelTurnResult;

    if (result.toolCalls.length === 0) {
      const replyText =
        result.text.trim() === "" ? FALLBACK_REPLY_TEXT : sanitizeReplyText(result.text);
      messages = [...messages, { role: "assistant", content: replyText }];
      return { messages, stepCount, guestTurnSpanId, firedTags };
    }

    // No tool has `execute`, so we dispatch and build the tool-result
    // message ourselves; a not-approved NEEDS_APPROVAL call returns
    // requestApproval's own not-approved fallback and never reaches
    // runApprovedTool/runTool at all.
    const toolOutputs = await Promise.all(
      result.toolCalls.map(async (call) => {
        // missing_info and send_booking_link both require real owner
        // approval before they may run at all. This block does ONLY that —
        // request approval (run-hitl.ts's requestApproval), then, on
        // rejection/timeout, return its not-approved fallback immediately.
        // No tool-calling code lives in this block: the actual dispatch
        // (run-hitl.ts's runApprovedTool) is a separate call below, outside
        // this block entirely, so approval and execution stay two visibly
        // distinct steps rather than one bundled underneath a single `if`.
        // Calls step.run/waitForEvent itself (inside requestApproval), so —
        // same as every tool's own dispatch below (see the "RULE" comment
        // above) — it must run un-nested here, never wrapped in an outer
        // step.run.
        let approvalDecision: HitlDecision<unknown> | undefined;
        if (NEEDS_APPROVAL.has(call.toolName)) {
          approvalDecision = await requestApproval(call, correlationId, toolContext);

          if (!approvalDecision.approved) {
            await step.run(traceIoStepId(call.toolName), () =>
              updateSpanIO(approvalDecision!.toolSpanId, {
                output: approvalDecision!.notApprovedOutput,
              }),
            );
            // See RunAgentTurnResult.firedTags for why this is collected
            // here rather than as a span attribute — pushed regardless of
            // the decision's outcome (approved/rejected/timed out all still
            // count as "this tool was attempted this turn").
            firedTags.push(call.toolName);
            return approvalDecision.notApprovedOutput;
          }
        }

        // Reached only once requestApproval above has resolved
        // `approved: true` — the real dispatch for a NEEDS_APPROVAL tool,
        // structurally separate from the approval block above (not nested
        // inside its `if`). Own step, distinct from the tool-span-creation
        // step inside requestApproval — memoized separately so a replay
        // after some later suspend elsewhere in the same turn doesn't re-run
        // it.
        if (approvalDecision) {
          const output = await step.run(`execute-${call.toolName}`, () =>
            runApprovedTool(call.toolName, call.input, approvalDecision!.payload, toolContext),
          );
          await step.run(traceIoStepId(call.toolName), () =>
            updateSpanIO(approvalDecision!.toolSpanId, { output }),
          );
          firedTags.push(call.toolName);
          return output;
        }

        // Every tool other than NEEDS_APPROVAL's two — including
        // wants_human — is called the same uniform way: runTool (run-tool.ts)
        // dispatches to that tool's own run<ToolName>, which creates and
        // owns its own gen_ai.tool.<name> execution span internally (this
        // app's run<ToolName> convention — see wants-human.ts's
        // runWantsHuman for the model every tool follows). This loop does no
        // span-wrapping of its own for these calls; each tool's own file
        // does. Re-executes on every Inngest replay like the rest of this
        // loop body, which is safe here for the same reason it's safe for
        // any self-stepped tool: each tool's own internal step.run calls (if
        // any) are individually memoized, so a replay resumes correctly
        // without re-running already-completed work.
        const output = await runTool(call.toolName, call.input, toolContext);
        // See RunAgentTurnResult.firedTags for why only wants_human (of the
        // tools reaching this point — NEEDS_APPROVAL's two never do) gets
        // collected here: firedTags is deliberately narrow, not "every tool
        // this turn used".
        if (call.toolName === "wants_human") {
          firedTags.push(call.toolName);
        }
        return output;
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
