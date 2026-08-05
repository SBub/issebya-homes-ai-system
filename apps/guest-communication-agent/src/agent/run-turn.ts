import crypto from "node:crypto";
import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import type { GetStepTools } from "inngest";
import { Client } from "langsmith";
import { loadMemory } from "@/agent/memory";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { missingInfo, runMissingInfo } from "@/agent/tools/missing-info";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { recordMessage } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { openrouter } from "@/lib/openrouter";
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
// callable/testable function — same shape DBOS.registerWorkflow used to
// wrap — so tests can drive it with a hand-rolled `step` mock instead of a
// real Inngest engine.
//
// runAgentTurn itself stays free of guest-delivery side effects (recording
// the reply, the proactive Twilio send) so it's easy to test/reason about in
// isolation, while runGuestTurn is the thing that adds those on top.

const MODEL = "deepseek/deepseek-v4-pro";
// SYSTEM_PROMPT_IDENTIFIER_OVERRIDE is for CI eval jobs only — must never be
// set in a real runtime environment.
const SYSTEM_PROMPT_IDENTIFIER =
  process.env.SYSTEM_PROMPT_IDENTIFIER_OVERRIDE ?? "whatsapp-booking-agent:production";

// Reasoning rounds, not individual tool calls (one round can dispatch several).
const MAX_AGENT_STEPS = 8;

const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

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
  wants_human: wantsHuman,
  missing_info: missingInfo,
} satisfies ToolSet;

// Tools that require a human's go-ahead before they run, checked in this
// file's own loop before dispatch (deliberately visible here, not hidden in
// a tool file). Gating sendBookingLink here means approval happens before
// the tool ever creates the booking URL / inserts booking_link_requests.
const NEEDS_HITL = new Set(["wants_human", "sendBookingLink"]);

// Tools whose own implementation calls context.step directly:
// missing_info's waitForMissingInfoReply calls step.waitForEvent to
// suspend. Inngest doesn't support calling a step tool from inside another
// step.run()'s callback — the callback must be a self-contained unit of
// work — so wants_human and missing_info are both dispatched directly from
// the loop below (never wrapped in an outer step.run) and manage their own
// checkpointing internally where they have any (wants_human currently has
// none of its own — it's grouped here for the same "never nest inside an
// outer step.run" reasoning, not because it calls step itself today). Every
// other tool has no step usage of its own, so wrapping the whole call in one
// step.run is safe and gives it real memoization/replay safety — the actual
// point of this migration.
const SELF_STEPPED_TOOLS = new Set(["wants_human", "missing_info"]);

// STUB — NOT REAL APPROVAL LOGIC. No durable suspend/pause yet; always
// resolves approved so wants_human/sendBookingLink keep working end-to-end.
// TODO(hitl): replace with a real suspend/resume once Inngest-backed approval exists.
async function requestHitlApproval(
  toolName: string,
  _input: Record<string, unknown>,
  _context: ToolContext,
): Promise<{ approved: boolean }> {
  console.warn(
    `[run-turn] requestHitlApproval STUB called for "${toolName}" — always approving, this is not real HITL yet`,
  );
  return { approved: true };
}

// One model call per round. Since none of `tools` has an `execute`,
// generateText only ever returns the model's requested tool calls — it
// never runs them itself.
interface ModelTurnResult {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>;
  response: { messages: ModelMessage[] };
}

async function modelTurn(system: string, messages: ModelMessage[]): Promise<ModelTurnResult> {
  const result = await generateText({
    model,
    system,
    messages,
    tools,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

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

// Dispatches a requested tool call to its run<ToolName> implementation.
// Called after the NEEDS_HITL gate below, never before it.
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
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0], context);
    case "wants_human":
      return runWantsHuman(input as Parameters<typeof runWantsHuman>[0], context);
    case "missing_info":
      return runMissingInfo(input as Parameters<typeof runMissingInfo>[0], context);
    default:
      throw new Error(`Unknown tool name: "${toolName}"`);
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

// The manifest's class id is namespaced under "langchain" rather than
// "langchain_core", so "prompts" must be supplied explicitly via importMap
// or load() throws "Invalid namespace".
async function pullSystemPromptTemplate() {
  const commit = await langsmithClient.pullPromptCommit(SYSTEM_PROMPT_IDENTIFIER);
  return load<prompts.ChatPromptTemplate>(JSON.stringify(commit.manifest), {
    importMap: { prompts },
  });
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
  // This run's Inngest step tools, threaded down explicitly since Inngest
  // (unlike DBOS) has no ambient "current workflow" equivalent to read from.
  step: GetStepTools<typeof inngest>;
}

export interface RunAgentTurnResult {
  messages: ModelMessage[];
  stepCount: number;
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
  const { triggerMessageId, correlationId, step } = config;

  const toolContext: ToolContext = { conversationId, phone, triggerMessageId, correlationId, step };

  const { historyMessages, contextBlock } = await loadMemory({ conversationId, phone });
  let messages: ModelMessage[] = [...historyMessages, { role: "user", content: incomingMessage }];

  let stepCount = 0;

  while (stepCount < MAX_AGENT_STEPS) {
    stepCount++;

    const promptTemplate = await pullSystemPromptTemplate();
    const promptValue = await promptTemplate.invoke({ guest_memory_block: contextBlock });
    const system = promptValue.toChatMessages()[0].content as string;

    // Cast needed: step.run()'s return type is run through Inngest's Jsonify
    // transform (step results are actually persisted as JSON and rehydrated
    // on replay), which narrows types like FilePart's `data: URL |
    // DataContent` down to their JSON-safe equivalents (an ArrayBuffer, for
    // instance, structurally loses its methods). GCA's ModelMessage content
    // here is always plain text/tool-call parts — this agent never sends or
    // receives file attachments — so the narrowing is a false positive for
    // this call site specifically, not a real runtime concern.
    const result = (await step.run(`model-${stepCount}`, () =>
      modelTurn(system, messages),
    )) as ModelTurnResult;

    if (result.toolCalls.length === 0) {
      messages = [...messages, { role: "assistant", content: sanitizeReplyText(result.text) }];
      return { messages, stepCount };
    }

    // No tool has `execute`, so we dispatch and build the tool-result
    // message ourselves; a rejected NEEDS_HITL call never reaches runToolCall.
    const toolOutputs = await Promise.all(
      result.toolCalls.map(async (call) => {
        if (NEEDS_HITL.has(call.toolName)) {
          const decision = await step.run(`hitl-approval-${call.toolName}`, () =>
            requestHitlApproval(call.toolName, call.input, toolContext),
          );
          if (!decision.approved) {
            return {
              approved: false,
              message: "This action was not approved. Do not retry it automatically.",
            };
          }
        }

        // See SELF_STEPPED_TOOLS above — wants_human/missing_info manage
        // their own step checkpointing and must not be nested inside
        // another step.run() call.
        return SELF_STEPPED_TOOLS.has(call.toolName)
          ? await runToolCall(call.toolName, call.input, toolContext)
          : await step.run(`tool-${call.toolName}`, () =>
              runToolCall(call.toolName, call.input, toolContext),
            );
      }),
    );
    messages = [
      ...messages,
      ...result.response.messages,
      toolResultMessage(result.toolCalls, toolOutputs),
    ];
  }

  return { messages, stepCount };
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
  // Random id for this run, set once in the webhook route. Lets
  // step.waitForEvent (see missing-info.ts) find this exact suspended run
  // when the owner's reply comes back as a separate event.
  correlationId: string;
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
  const { conversationId, phone, incomingMessage, triggerMessageId, correlationId, step } = params;

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    { triggerMessageId, correlationId, step },
  );

  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Sorry, I couldn't process that — please try again shortly.";

  await step.run("record-reply", () =>
    // NOT a real LangSmith trace id — nothing on LangSmith's side matches it,
    // so a later feedback submission against it will fail.
    recordMessage(conversationId, "assistant", replyText, crypto.randomUUID()),
  );

  await step.run("send-whatsapp-reply", async () => {
    const sendResult = await sendWhatsAppMessage(phone, replyText);
    if (!sendResult.ok) {
      console.error(`[run-turn] sendWhatsAppMessage failed for ${phone}: ${sendResult.error}`);
    }
    return sendResult;
  });
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
