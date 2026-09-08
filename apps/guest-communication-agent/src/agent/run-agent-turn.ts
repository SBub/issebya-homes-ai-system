import { type JSONValue, type ModelMessage } from "ai";
import { loadPrompt } from "braintrust";
import type { GetStepTools } from "inngest";
import { type AgentMemory, loadMemory } from "@/agent/memory";
import { MODEL, type ModelTurnResult, runModel } from "@/agent/run-model";
import { runTool, type ToolName } from "@/agent/run-tool";
import { flushTracing } from "@/instrumentation";
import type { HitlDecision } from "@/agent/tools/approval-gate";
import { requestSendBookingLinkApproval } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { requestMissingInfoApproval } from "@/agent/tools/missing-info";
import { inngest } from "@/lib/inngest";
import { steppedSpan, type TraceAnchor } from "@/lib/tracing";

// GCA's reasoning loop: build the message list, then repeatedly call the
// model and dispatch any tool calls it requested, until a final text reply
// or the step cap fires.

// No pinned version — loadPrompt() with neither `version` nor `environment`
// fetches the slug's latest Braintrust-saved version, so every save there is
// live immediately. Environments (staged promotion) is Pro-plan-only,
// unavailable in this org.
const SYSTEM_PROMPT_SLUG = "gca-system";

// Reasoning rounds, not individual tool calls (one round can dispatch several).
const MAX_AGENT_STEPS = 8;

// Sending the model's raw "" straight to Twilio 400s (empty message body) —
// this is the fallback for that and any other "no usable reply" case. Also
// used by run-guest-turn.ts when a turn ends with no final assistant message
// at all (e.g. the step cap hit mid tool-call).
export const FALLBACK_REPLY_TEXT = "Sorry, I couldn't process that — please try again shortly.";

// RULE (canonical): every tool owns its own gen_ai.tool.<name> execution
// span and any step/waitForEvent usage it needs, inside its own
// run<ToolName> under src/agent/tools/ (see wants-human.ts's runWantsHuman
// for the model). This loop calls tools uniformly below and does no
// span-wrapping of its own.
//
// Two tiers, by how much step/span machinery a tool needs:
// - The 5 plain tools + wants_human: no side effect worth protecting beyond
//   one atomic unit of work, so each wraps its logic in one steppedSpan call
//   (tool-execution.ts's dispatchToolExecution is the shared helper). Only
//   wants_human needs more than one step, for a real Telegram send that must
//   not double-fire on retry — see its own file's comment.
// - missing_info/send_booking_link (NEEDS_APPROVAL below): a genuine
//   suspend that can last up to a year, so approval and execution are two
//   separate spans and two separate, sequential calls (see the NEEDS_APPROVAL
//   branch below and missing-info.ts's/booking.ts's own comments) —
//   deliberately not bundled into one function.
//
// LANDMINE: Inngest doesn't support calling a step tool from inside another
// step.run()'s callback — the callback must be self-contained — which is why
// every tool dispatches its own step.run calls itself rather than this loop
// wrapping them from outside.

// Which tools need approval before running, checked via isGatedTool below.
// wants_human is deliberately NOT here — it's a one-way alert with no
// decision to gate on. `satisfies readonly ToolName[]` checks each entry
// against run-tool.ts's real tool registry at compile time; GatedToolName
// (derived below) is what lets isGatedTool narrow call.toolName, since
// Set<string>.has() doesn't.
const NEEDS_APPROVAL = ["missing_info", "send_booking_link"] as const satisfies readonly ToolName[];
type GatedToolName = (typeof NEEDS_APPROVAL)[number];

function isGatedTool(toolName: string): toolName is GatedToolName {
  return (NEEDS_APPROVAL as readonly string[]).includes(toolName);
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
  triggerMessageId?: string;
  correlationId: string;
  traceAnchor: TraceAnchor;
  // Threaded down explicitly since Inngest has no ambient "current workflow"
  // to read from.
  step: GetStepTools<typeof inngest>;
}

export interface RunAgentTurnResult {
  messages: ModelMessage[];
  stepCount: number;
  guestTurnSpanId: string;
  // Deliberately narrow, not "every tool this turn used": only wants_human,
  // missing_info, and send_booking_link ever get pushed here — the tools
  // worth a turn-level "did this happen" signal, unlike the 5 plain tools
  // which fire on nearly every turn and would just be noise as a tag.
  firedTags: string[];
}

// Loads context, then loops model -> tools -> model until a final text
// reply or the step cap is hit. This function runs inside a run-guest-turn
// Inngest function (see run-guest-turn.ts's runGuestTurn) so a genuine
// suspend (e.g. missing_info's step.waitForEvent) is safe to sit inside the
// loop.
export async function runAgentTurn(
  input: RunAgentTurnInput,
  config: RunAgentTurnConfig,
): Promise<RunAgentTurnResult> {
  const { conversationId, phone } = input;
  const { triggerMessageId, correlationId, traceAnchor, step } = config;

  // Near-zero-duration marker span, once per turn — gives every trace a
  // clean root node in Braintrust. Its real span id is captured so
  // runGuestTurn's later "update-turn-trace-io" step can patch it with the
  // turn's final input/output via updateSpanIO (tracing.ts) — a span whose
  // own attributes don't clear @braintrust/otel's export-filter prefixes
  // (see tracing.ts's Braintrust-attribute-namespace comment), so its name
  // does instead ("braintrust." prefix).
  const guestTurnSpanId = await steppedSpan(
    step,
    "start-trace",
    traceAnchor,
    "braintrust.guest_turn",
    { "gca.conversation_id": conversationId, "gca.phone": phone },
    async (span) => span.spanContext().spanId,
  );
  // See updateSpanIO's doc comment (tracing.ts) for why this flush must
  // happen before the later patch, or the patch can be silently lost.
  await flushTracing();

  // Every span from here nests under "braintrust.guest_turn" instead of
  // traceAnchor directly, giving the turn's own spans proper parent/child
  // structure instead of all landing as its siblings.
  const turnAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: guestTurnSpanId };

  const toolContext: ToolContext = {
    conversationId,
    phone,
    triggerMessageId,
    correlationId,
    traceAnchor: turnAnchor,
    step,
  };

  // Cast: see steppedSpan's doc comment (tracing.ts) — step.run()'s return
  // type is narrowed by Inngest's Jsonify transform; loadMemory's real
  // return value is already JSON-safe, so this is a false positive.
  const { historyMessages, memoryMessage } = (await steppedSpan(
    step,
    "load-memory",
    turnAnchor,
    "load-memory",
    { "gca.conversation_id": conversationId },
    () => loadMemory({ conversationId, phone }),
  )) as AgentMemory;
  // historyMessages already ends with this turn's incoming message (the
  // webhook route records it before enqueuing the turn) — don't append it
  // again. memoryMessage (guest preferences/recent fold) is prepended as its
  // own message, omitted entirely when loadMemory has nothing to say.
  let messages: ModelMessage[] = memoryMessage
    ? [memoryMessage, ...historyMessages]
    : historyMessages;

  // Hoisted out of the loop — fetched once per turn, not once per round,
  // since un-stepped code between step.run checkpoints re-runs on every
  // Inngest replay (a replay reaching round N would otherwise re-fetch the
  // prompt for every already-completed round).
  async function loadSystemPromptText(): Promise<string> {
    const promptTemplate = await loadPrompt({
      projectId: process.env.BRAINTRUST_PROJECT_ID,
      slug: SYSTEM_PROMPT_SLUG,
      defaults: { model: MODEL },
    });
    const { messages } = promptTemplate.build({});
    return messages[0].content as string;
  }

  // Cast: same steppedSpan narrowing as above; this prompt is always a
  // plain string.
  const system = (await steppedSpan(
    step,
    "load-system-prompt",
    turnAnchor,
    "load-system-prompt",
    {},
    loadSystemPromptText,
  )) as string;

  let stepCount = 0;
  const firedTags: string[] = [];

  while (stepCount < MAX_AGENT_STEPS) {
    stepCount++;

    // Cast: same steppedSpan narrowing as above (raw step.run here since
    // runModel opens its own withTurnSpan internally); GCA's ModelMessage
    // content is always plain text/tool-call parts.
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
    // message ourselves; a not-approved NEEDS_APPROVAL call returns its own
    // fallback and never reaches runTool.
    const toolOutputs = await Promise.all(
      result.toolCalls.map(async (call) => {
        // Approval (this switch) and execution (runTool below) are two
        // separate, sequential calls on purpose — never bundled into one
        // function — so a gated tool's approval decision stays visibly
        // distinct from its execution. Inlined rather than a named
        // dispatcher since this is the one place that needs to know "how do
        // I get a decision for tool X". Must run un-nested (see the RULE
        // comment above).
        let approvalDecision: HitlDecision<unknown> | undefined;
        if (isGatedTool(call.toolName)) {
          switch (call.toolName) {
            case "missing_info":
              approvalDecision = await requestMissingInfoApproval(
                call.input as { reason: string },
                toolContext,
              );
              break;
            case "send_booking_link":
              approvalDecision = await requestSendBookingLinkApproval(
                call,
                correlationId,
                toolContext,
              );
              break;
            default: {
              // Compile-time exhaustiveness check (isGatedTool narrows
              // call.toolName to GatedToolName) — a third gated tool added
              // without a case here fails the build.
              const exhaustiveCheck: never = call.toolName;
              throw new Error(`unhandled gated tool "${exhaustiveCheck}"`);
            }
          }

          if (!approvalDecision.approved) {
            firedTags.push(call.toolName);
            return approvalDecision.notApprovedOutput;
          }
        }

        // Every tool — wants_human and, once approved, NEEDS_APPROVAL's two
        // included — goes through this one runTool call, with no span/step
        // wrapping here; each tool's own run<ToolName> owns its own tracing.
        // approvalDecision is threaded through only so missing_info's
        // run<ToolName> can read its `payload` (the owner's answer).
        const output = await runTool(call.toolName, call.input, toolContext, approvalDecision);
        if (call.toolName === "wants_human" || approvalDecision) {
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
