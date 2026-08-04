import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { Client } from "langsmith";
import { loadMemory } from "@/agent/memory";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import { complaint, runComplaint } from "@/agent/tools/complaint";
import type { ToolContext } from "@/agent/tools/config";
import { missingInfo, runMissingInfo } from "@/agent/tools/missing-info";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";
import { runWantsHuman, wantsHuman } from "@/agent/tools/wants-human";
import { openrouter } from "@/lib/openrouter";

// GCA's reasoning loop: build the message list, then repeatedly call the
// model and dispatch any tool calls it requested, until a final text reply
// or the step cap fires. Stateless per invocation — loadMemory reloads guest
// history fresh from Postgres every turn.

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
// below. The escalation tools' keys are the literal snake_case tool names
// the model sees (deliberately unlike the camelCase tools here).
const tools = {
  getPricing,
  checkAvailability,
  answerPropertyQuestion,
  sendBookingLink,
  wants_human: wantsHuman,
  complaint: complaint,
  missing_info: missingInfo,
} satisfies ToolSet;

// Tools that require a human's go-ahead before they run, checked in this
// file's own loop before dispatch (deliberately visible here, not hidden in
// a tool file). Gating sendBookingLink here means approval happens before
// the tool ever creates the booking URL / inserts booking_link_requests.
const NEEDS_HITL = new Set(["wants_human", "sendBookingLink"]);

// STUB — NOT REAL APPROVAL LOGIC. No durable suspend/pause yet; always
// resolves approved so wants_human/sendBookingLink keep working end-to-end.
// TODO(hitl): replace with a real suspend/resume once DBOS-backed approval exists.
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
    case "complaint":
      return runComplaint(input as Parameters<typeof runComplaint>[0], context);
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
  // model-driven wants_human/complaint/missing_info tools' ToolContext (see
  // performEscalation in escalation-shared.ts).
  triggerMessageId?: string;
}

export interface RunAgentTurnResult {
  messages: ModelMessage[];
  stepCount: number;
}

// Runs one full guest turn: loads context, then loops model -> tools ->
// model until a final text reply, or the step cap is hit.
//
// After ANY tool call, including missing_info (which genuinely suspends via
// DBOS.recv until the owner replies or times out — this function runs inside
// a DBOS workflow, see @/agent/run-guest-turn.ts), the loop goes back to the
// model for a real final reply.
export async function runAgentTurn(
  input: RunAgentTurnInput,
  config: RunAgentTurnConfig = {},
): Promise<RunAgentTurnResult> {
  const { conversationId, phone, incomingMessage } = input;
  const { triggerMessageId } = config;

  const toolContext: ToolContext = { conversationId, phone, triggerMessageId };

  const { historyMessages, contextBlock } = await loadMemory({ conversationId, phone });
  let messages: ModelMessage[] = [...historyMessages, { role: "user", content: incomingMessage }];

  let stepCount = 0;

  while (stepCount < MAX_AGENT_STEPS) {
    stepCount++;

    const promptTemplate = await pullSystemPromptTemplate();
    const promptValue = await promptTemplate.invoke({ guest_memory_block: contextBlock });
    const system = promptValue.toChatMessages()[0].content as string;

    const result = await modelTurn(system, messages);

    if (result.toolCalls.length === 0) {
      messages = [...messages, { role: "assistant", content: sanitizeReplyText(result.text) }];
      return { messages, stepCount };
    }

    // No tool has `execute`, so we dispatch and build the tool-result
    // message ourselves; a rejected NEEDS_HITL call never reaches runToolCall.
    const toolOutputs = await Promise.all(
      result.toolCalls.map(async (call) => {
        if (NEEDS_HITL.has(call.toolName)) {
          const decision = await requestHitlApproval(call.toolName, call.input, toolContext);
          if (!decision.approved) {
            return {
              approved: false,
              message: "This action was not approved. Do not retry it automatically.",
            };
          }
        }
        return runToolCall(call.toolName, call.input, toolContext);
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
