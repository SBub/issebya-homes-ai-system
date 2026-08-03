import { createOpenAI } from "@ai-sdk/openai";
import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { Client } from "langsmith";
import { loadContext } from "@/agent/load-context";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { escalateToOwner, runEscalateToOwner } from "@/agent/tools/escalation";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";

// GCA's reasoning loop: build the message list, then repeatedly call the
// model and dispatch any tool calls it requested, until a final text reply
// or the step cap fires. Stateless per invocation — loadContext reloads
// guest history fresh from Postgres every turn, which remains the system of
// record, not any state held here.

const MODEL = "deepseek/deepseek-v4-pro";
// Pinned to the `production` tag so a new prompt commit needs an explicit
// promotion step before it takes effect. SYSTEM_PROMPT_IDENTIFIER_OVERRIDE
// exists only for CI eval jobs scoring an unpromoted candidate commit — must
// never be set in a real runtime environment.
const SYSTEM_PROMPT_IDENTIFIER =
  process.env.SYSTEM_PROMPT_IDENTIFIER_OVERRIDE ?? "whatsapp-booking-agent:production";

// Ceiling on reasoning rounds (loop iterations, not individual tool calls —
// one round can dispatch several tool calls at once, see runToolCall).
const MAX_AGENT_STEPS = 8;

// Module-level: also owns pullPromptCommit's internal per-identifier cache,
// so repeated pulls within a turn stay cheap.
const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

// Points at OpenRouter's OpenAI-compatible base URL. `.chat(MODEL)` targets
// the Chat Completions API — the bare `openrouter(MODEL)` call would target
// OpenAI's Responses API instead, which OpenRouter doesn't support.
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
const model = openrouter.chat(MODEL);

// Explicit because MODEL is a reasoning model: its internal "thinking"
// tokens draw from the same completion budget as the visible reply, so too
// low a cap can make it silently return an empty string (confirmed via a
// real trace). 1000 leaves headroom for both.
const MAX_OUTPUT_TOKENS = 1000;

// Schema-only tool declarations (no `execute`) — dispatch happens manually
// in runToolCall() below, driven by this file's own while loop.
const tools = {
  getPricing,
  checkAvailability,
  answerPropertyQuestion,
  sendBookingLink,
  escalateToOwner,
} satisfies ToolSet;

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

// Looks up the run<ToolName> implementation matching a requested tool call
// and invokes it directly with this turn's ToolContext (only sendBookingLink
// and escalateToOwner need it). Throws on an unrecognized tool name.
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
    case "escalateToOwner":
      return runEscalateToOwner(input as Parameters<typeof runEscalateToOwner>[0], context);
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

// Pulls the prompt commit from LangSmith's Prompt Hub and deserializes it via
// @langchain/core/load — the manifest's class id is namespaced under
// "langchain" rather than "langchain_core", so the "prompts" module must be
// supplied explicitly via importMap or load() throws "Invalid namespace".
// This is the one deliberate residual @langchain/core usage kept after the
// AI SDK migration; the caller flattens the result to a plain string
// immediately, so nothing downstream ever sees a LangChain object.
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
  // This turn's inbound whatsapp_messages row id, passed to both the
  // model-driven escalateToOwner tool and this file's own deterministic
  // performEscalation safety-net calls below.
  triggerMessageId?: string;
}

export interface RunAgentTurnResult {
  messages: ModelMessage[];
  missingInfoEscalated: boolean;
  stepCount: number;
}

// Runs one full guest turn: loads context, then loops model -> tools ->
// model until a final text reply or a safety net fires.
//
// Control flow to preserve carefully: after ANY tool call (including
// escalateToOwner, regardless of reason_category) the loop goes back for
// another model round. missingInfoEscalated is STICKY — once a missing_info
// escalateToOwner call happens, it stays true for the rest of this
// function's return even though the loop keeps running and the model may go
// on to compose real text afterward. The caller (the webhook route) only
// reads the final missingInfoEscalated/messages once the loop ends, so that
// extra text is simply discarded when the flag is true. This is deliberate,
// not a bug — do not "simplify" it away.
export async function runAgentTurn(
  input: RunAgentTurnInput,
  config: RunAgentTurnConfig = {},
): Promise<RunAgentTurnResult> {
  const { conversationId, phone, incomingMessage } = input;
  const { triggerMessageId } = config;

  const toolContext: ToolContext = { conversationId, phone, triggerMessageId };

  const { historyMessages, guestContext } = await loadContext({ conversationId, phone });
  let messages: ModelMessage[] = [...historyMessages, { role: "user", content: incomingMessage }];

  // Past-stay facts from guest_contacts (see load-context.ts). Plain content
  // only — the prompt template owns the <guest_memory> XML wrapper around
  // {guest_memory_block}.
  const guestMemoryBlock = guestContext ?? "No prior guest information available.";

  let stepCount = 0;
  let missingInfoEscalated = false;

  while (stepCount < MAX_AGENT_STEPS) {
    stepCount++;

    const promptTemplate = await pullSystemPromptTemplate();
    const promptValue = await promptTemplate.invoke({ guest_memory_block: guestMemoryBlock });
    const system = promptValue.toChatMessages()[0].content as string;

    const result = await modelTurn(system, messages);

    if (result.toolCalls.length === 0) {
      messages = [...messages, { role: "assistant", content: sanitizeReplyText(result.text) }];
      // NOT forced to false — sticky, see this function's doc comment.
      return { messages, stepCount, missingInfoEscalated };
    }

    // response.messages carries this round's assistant message (with its
    // tool-call parts) but no tool-result message, since no tool has an
    // `execute`. Dispatch each call for real, in parallel, then build and
    // append this round's tool-result message ourselves.
    const toolOutputs = await Promise.all(
      result.toolCalls.map((call) => runToolCall(call.toolName, call.input, toolContext)),
    );
    messages = [
      ...messages,
      ...result.response.messages,
      toolResultMessage(result.toolCalls, toolOutputs),
    ];

    const escalateCall = result.toolCalls.find((call) => call.toolName === "escalateToOwner");
    const escalateArgs = escalateCall?.input as { reason_category?: string } | undefined;
    if (escalateArgs?.reason_category === "missing_info") {
      missingInfoEscalated = true;
    }
    // Loop continues — do not return early here.
  }

  return { messages, stepCount, missingInfoEscalated };
}
