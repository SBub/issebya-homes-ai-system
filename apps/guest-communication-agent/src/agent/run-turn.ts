import { createOpenAI } from "@ai-sdk/openai";
import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { generateText, type JSONValue, type ModelMessage, type ToolSet } from "ai";
import { Client } from "langsmith";
import { loadContext } from "@/agent/load-context";
import { checkAvailability, runCheckAvailability } from "@/agent/tools/availability";
import { runSendBookingLink, sendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { escalateToOwner, performEscalation, runEscalateToOwner } from "@/agent/tools/escalation";
import { getPricing, runGetPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion, runAnswerPropertyQuestion } from "@/agent/tools/property-question";

// This is GCA's whole reasoning loop: build the message list, then
// repeatedly { call the model -> run any tool calls it asked for -> feed
// the results back } until a final text reply, the step cap, or the
// empty-reply safety net. It replaces what used to be a LangGraph.js
// StateGraph (one node per tool, a MemorySaver checkpointer, conditional-
// edge routing) — GCA is a single agent with a single sequential
// tool-calling loop, no multi-agent routing/supervision/fan-out, so that
// machinery was ceremony, not something earning its keep. This function
// preserves the exact same runtime behavior the graph had, including the
// control-flow quirks documented inline below — it is a structural
// simplification, not a behavior change.
//
// As of the LangChain -> Vercel AI SDK migration, the model call itself
// (generateText, from "ai") no longer runs tool_calls for us — every tool in
// src/agent/tools/*.ts is a schema-only `tool()` declaration (description +
// inputSchema, no `execute`), so generateText only ever returns the model's
// requested tool calls, never their results. Dispatch is manual: modelTurn()
// below makes exactly one generateText call, and runToolCall() looks up the
// matching run<ToolName> implementation function by name and calls it
// directly with this turn's ToolContext. This mirrors the modelTurn/toolStep/
// runTool split in the reference harness
// (harness-engineering/harness/runtime.ts) minus everything that harness
// needed and GCA doesn't: no durable-workflow step checkpointing (GCA isn't a durable workflow), no
// event-bus emission, no memory compaction (GCA's history is small and
// reloaded fresh every turn via loadContext, not accumulated across an
// unbounded number of turns in-process), no multi-agent handoff (GCA is a
// single agent), and no human-in-the-loop approval gating (no tool here is
// irreversible enough to need it). This file's own while loop drives the
// round-by-round control flow (one modelTurn() call per round, never AI
// SDK's own multi-step auto-looping — moot now anyway since no tool has an
// `execute` for AI SDK to auto-run) so the step-cap/empty-reply-retry/
// sticky-missingInfoEscalated semantics below stay exactly as deliberate and
// inspectable as they were before.
//
// Stateless per-invocation: the caller passes conversationId/phone/
// incomingMessage every turn, and loadContext (@/agent/load-context.ts)
// loads recent history + guest info fresh from Postgres
// (whatsapp_messages/whatsapp_conversations/guest_contacts, via
// @/lib/db.ts's createAdminClient()), which remains the system of record —
// not any in-memory state here. No checkpointer, no thread_id: those only
// ever existed for LangGraph Studio's interactive debugging, never
// production persistence.

const MODEL = "deepseek/deepseek-v4-pro";
// Pinned to the explicit `production` tag, not the bare identifier — a bare
// identifier resolves to whatever commit was pushed most recently, meaning
// every `pushPrompt` would take effect immediately with no review step. New
// prompt versions must be explicitly tagged `production` (via
// `Client._createCommitTags(ownerAndName, commitId, ['production'])` — note
// commitId is the commit's internal UUID from `listCommits`, not its
// `commit_hash`) before they actually take effect here.
//
// Overridable via SYSTEM_PROMPT_IDENTIFIER_OVERRIDE for exactly one purpose:
// CI eval runs that need to score one specific candidate prompt commit
// *before* it's promoted to `production`. Must never be set in any real
// runtime environment — leaving it unset everywhere except CI eval jobs is
// what guarantees production traffic always uses the reviewed, tagged
// prompt, not whatever was most recently committed to the Hub.
const SYSTEM_PROMPT_IDENTIFIER =
  process.env.SYSTEM_PROMPT_IDENTIFIER_OVERRIDE ?? "whatsapp-booking-agent:production";

// Deterministic ceiling on reasoning rounds (loop iterations, not tool
// calls — one round can dispatch several tool calls in parallel, run via
// runToolCall() below, see that function's own comment). 8 gives headroom
// for all 5 tools to each be tried once, plus 2 retry/reformulation rounds,
// plus 1 final text-only round.
const MAX_AGENT_STEPS = 8;

// Module-level client, reused across turns/invocations. Also owns
// pullPromptCommit's internal per-identifier cache, so repeated pulls within
// a single tool-calling loop are cheap.
const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

// Configured for OpenRouter — same convention as
// @/tools/search-property.ts's own `openrouter` client (createOpenAI from
// @ai-sdk/openai, pointed at OpenRouter's OpenAI-compatible base URL)
// instead of a dedicated OpenRouter SDK. `.chat(MODEL)` (not the bare
// `openrouter(MODEL)` call, which targets OpenAI's Responses API) matches
// OpenRouter's actual Chat Completions-shaped API, the same wire format
// ChatOpenAI used before this migration.
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});
const model = openrouter.chat(MODEL);

// maxOutputTokens is explicit because MODEL is a reasoning model — its
// internal "thinking" tokens count against the same completion budget as
// the visible reply, not a separate allowance. Confirmed via a real trace:
// on a hard, ambiguous prompt, the model spent its entire (unset-default,
// apparently very small) completion budget on reasoning and returned a
// literal empty string as the reply (finish_reason: "stop", content: "",
// with output_token_details.reasoning equal to the full completion token
// count). A tighter prompt rule reduced reasoning tokens spent on that same
// case (41 -> 21) but didn't fix it alone — the ceiling was still too low
// for any reasoning plus a real answer to both fit. 1000 gives real
// headroom for both on top of a typical short conversational reply.
const MAX_OUTPUT_TOKENS = 1000;

// Same 5 tools as before, same order — checkAvailability, getPricing,
// sendBookingLink, answerPropertyQuestion, escalateToOwner. No barrel/index
// file for these (see src/agent/tools/*.ts): each is imported directly from
// its own file and assembled here.
//
// A single module-level instance, unlike the old per-turn buildAgentTools()
// factory — every tool here is now a schema-only declaration (no `execute`
// closing over conversationId/phone/triggerMessageId), so there is nothing
// turn-specific left to bind at tool-build time. That context is threaded
// through runToolCall()'s ToolContext argument instead, at dispatch time,
// once per round.
const tools = {
  getPricing,
  checkAvailability,
  answerPropertyQuestion,
  sendBookingLink,
  escalateToOwner,
} satisfies ToolSet;

// One raw model call per round — mirrors the reference harness's modelTurn
// (harness-engineering/harness/runtime.ts), minus its durable-workflow step wrapper and
// event-bus streaming (see this file's header comment for what wasn't
// ported). Since none of `tools` has an `execute`, generateText here only
// ever returns the model's requested tool calls (if any) plus its own
// assistant message with the matching tool-call parts in
// `response.messages` — it never runs those calls or produces any tool-role
// result message itself. Turning those calls into results is runToolCall()'s
// job, driven by this file's own while loop below.
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
    // maxOutputTokens is explicit — see its own module-level constant's
    // comment for why.
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

// Manual by-name tool-call dispatcher — mirrors the reference harness's
// runTool (harness-engineering/harness/tools.ts, imported into its
// toolStep). Looks up the matching run<ToolName> implementation function
// (each exported alongside its schema-only `tool()` declaration from its own
// src/agent/tools/*.ts file) and calls it directly with this already-
// validated input, passing `context` through to the two tools that need it
// (sendBookingLink, escalateToOwner). Throws on an unrecognized tool name —
// the old LangChain-based loop's findToolByName()/invokeTool() step had the
// same guard; it became moot for a while once dispatch moved entirely inside
// AI SDK's generateText, and is relevant again now that this file owns
// dispatch itself.
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

// Builds this round's tool-result ModelMessage from every tool call's
// output, batched into a single "tool" role message with one content part
// per call — the same shape AI SDK itself produces when a step dispatches
// multiple tool calls at once (and what the guest-turn history stored before
// this manual-dispatch change), so downstream history/replay code doesn't
// need to special-case single- vs multi-call rounds.
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

// Pulls the `whatsapp-booking-agent` prompt from LangSmith's Prompt Hub and
// deserializes its manifest into a real, invokable ChatPromptTemplate.
// pullPromptCommit() returns the manifest as a plain LangChain-serialized
// object graph, not a ready-to-use object — load() does the deserialization.
// It needs an explicit importMap: the manifest's class id is namespaced under
// "langchain" rather than "langchain_core" (the only namespace @langchain/core
// resolves for free), so the "prompts" module has to be supplied by hand or
// load() throws "Invalid namespace".
//
// This is deliberately the one narrow @langchain/core usage kept after the
// LangChain -> AI SDK migration (prompts only — not @langchain/openai, not
// @langchain/core/tools, not message classes). LangSmith's `langsmith`
// package itself exposes no lighter helper that returns a prompt commit's
// manifest as plain text/a plain object: pullPromptCommit()'s `manifest` is
// just `Record<string, any>` (the raw serialized graph), and the only other
// candidate, the private `_pullPrompt` ("should not be used directly, use
// `import { pull } from 'langchain/hub'` instead"), returns that same JSON
// string, not plain text — so deserializing via @langchain/core/load's
// load() remains the only real option for turning a Prompt Hub commit into
// usable text. The caller below immediately flattens the result to a plain
// string right after invoking it with this turn's guest_memory_block, so
// nothing downstream of this function ever sees a LangChain message object.
async function pullSystemPromptTemplate() {
  const commit = await langsmithClient.pullPromptCommit(SYSTEM_PROMPT_IDENTIFIER);
  return load<prompts.ChatPromptTemplate>(JSON.stringify(commit.manifest), {
    importMap: { prompts },
  });
}

// The prompt's "no em dash" / "no bold" rules are purely mechanical,
// deterministic constraints (unlike scope discipline or tool selection,
// which need real judgment) — but the model doesn't follow them 100% of the
// time regardless. Enforcing both in code guarantees compliance instead of
// hoping the instructions stick. Bold stripping keeps the wrapped text, only
// removes the asterisks — "**Hairdryer**"/"*Hairdryer*" both become
// "Hairdryer" rather than being deleted outright.
export function sanitizeReplyText(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

// AI SDK-native emptiness check, replacing the old
// `content.trim() === "" && !tool_calls.length` check on a LangChain
// AIMessage. `result.text`/`result.toolCalls` are always populated (never
// undefined) on a GenerateTextResult, unlike AIMessage.content, which could
// be a non-string multi-part array in principle.
function isEmptyResponse(result: { text: string; toolCalls: unknown[] }): boolean {
  return result.text.trim() === "" && result.toolCalls.length === 0;
}

export interface RunAgentTurnInput {
  conversationId: string;
  phone: string;
  incomingMessage: string;
}

export interface RunAgentTurnConfig {
  // Same triggerMessageId the webhook route used to thread through
  // RunnableConfig.configurable — this turn's own inbound whatsapp_messages
  // row id, passed to both the model-driven escalateToOwner tool (via
  // runToolCall()'s ToolContext argument) and run-turn.ts's own
  // deterministic performEscalation safety-net calls below.
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
// The control flow below must match what the old graph did exactly — this
// is the part most likely to get silently "cleaned up" by an over-eager
// simplification, so it's spelled out in full:
//
// After ANY tool fires (including escalateToOwner, regardless of
// reason_category), the loop goes back around for another model round — the
// model gets a chance to compose more text, possibly more tool calls, etc.
// missingInfoEscalated is STICKY: once a missing_info escalateToOwner call
// happens in some round, it stays true for the rest of this function's
// return, even though the loop keeps running afterward. The caller (the
// webhook route) only looks at the FINAL missingInfoEscalated/messages after
// the whole loop ends — so if escalateToOwner fires with missing_info, the
// model still runs at least one more round and composes real text, and that
// text is simply thrown away by the caller because the flag is true. This
// looks wasteful but is current, deliberate-enough-to-not-silently-fix
// production behavior — preserved exactly, not "fixed" here.
export async function runAgentTurn(
  input: RunAgentTurnInput,
  config: RunAgentTurnConfig = {},
): Promise<RunAgentTurnResult> {
  const { conversationId, phone, incomingMessage } = input;
  const { triggerMessageId } = config;

  // Threaded into runToolCall() below for the two tools that need it
  // (sendBookingLink, escalateToOwner) — see this file's module-level
  // `tools` comment for why this no longer needs to be a closure-based
  // per-turn tool factory.
  const toolContext: ToolContext = { conversationId, phone, triggerMessageId };

  const { historyMessages, guestContext } = await loadContext({ conversationId, phone });
  let messages: ModelMessage[] = [...historyMessages, { role: "user", content: incomingMessage }];

  // guestContext holds past-stay facts from guest_contacts (see
  // load-context.ts/db.ts's loadGuestInfo) — guest-specific background the
  // model should be aware of. Plain content only — the prompt template
  // itself owns the <guest_memory> XML wrapper around
  // {guest_memory_block}.
  const guestMemoryBlock = guestContext ?? "No prior guest information available.";

  let stepCount = 0;
  let missingInfoEscalated = false;

  while (true) {
    stepCount++;

    // Safety net for pathological cases (a tool that keeps failing, a model
    // that won't stop retrying/reformulating, etc.) — not a change to normal
    // behavior. A typical turn resolves in 1-2 rounds and never comes near
    // this branch. When it does, skip the model call entirely (no LLM
    // latency, no chance of yet another tool-calling response looping this
    // further) and perform a real escalation — the same DB insert + Telegram
    // notification escalateToOwner gives the model when it chooses to
    // escalate itself, just triggered deterministically instead of by the
    // model's own judgment.
    if (stepCount > MAX_AGENT_STEPS) {
      await performEscalation({
        conversationId,
        phone,
        // Leads with the guest's actual current-turn question rather than
        // just the technical failure description: the owner sees this exact
        // string in the Telegram nudge and needs to know what to actually
        // answer, not just that the agent looped.
        reason: `Guest asked: "${incomingMessage}" — agent reasoning loop exceeded ${MAX_AGENT_STEPS} rounds without reaching a final answer.`,
        // Not one of the three guest-driven triggers escalateToOwner's
        // schema documents (the guest didn't do anything in particular
        // here) — this is a deterministic safety net, not a model judgment
        // call. Of the three categories, missing_info is the closest fit:
        // the agent is fundamentally failing to land on a real answer for
        // the guest's question, the same shape as answerPropertyQuestion
        // coming up empty, just via a different failure mode (looping
        // instead of an empty result).
        reasonCategory: "missing_info",
        triggerMessageId,
      });

      return {
        messages: [
          ...messages,
          {
            role: "assistant",
            content:
              "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
          },
        ],
        stepCount,
        // Always missing_info for this branch (see reasonCategory above) —
        // the webhook route uses this to suppress the interim message above
        // from ever reaching the guest.
        missingInfoEscalated: true,
      };
    }

    const promptTemplate = await pullSystemPromptTemplate();
    const promptValue = await promptTemplate.invoke({ guest_memory_block: guestMemoryBlock });
    // Flattened to a plain string immediately — see pullSystemPromptTemplate's
    // own comment on why this is the one place a LangChain object still
    // passes through, and why nothing past this line ever sees it.
    const system = promptValue.toChatMessages()[0].content as string;

    // Exactly one model call per invokeModel() call — this file's own while
    // loop drives further rounds itself, one modelTurn() per round (see
    // modelTurn's own comment for why this is safe now that no tool has an
    // `execute` for AI SDK to auto-run beyond this single call anyway).
    const invokeModel = () => modelTurn(system, messages);

    let result = await invokeModel();

    // MODEL is a reasoning model — confirmed via real traces that it can
    // return a genuinely empty reply (text: "", toolCalls: [],
    // finish_reason: "stop") on a hard/ambiguous turn, having spent its
    // whole completion budget on internal reasoning with nothing left for
    // visible output. One retry first, since it isn't fully deterministic;
    // if it recurs, treat it the same as the MAX_AGENT_STEPS case — skip
    // straight to a real escalation rather than sending the guest nothing.
    if (isEmptyResponse(result)) {
      result = await invokeModel();
    }

    if (isEmptyResponse(result)) {
      await performEscalation({
        conversationId,
        phone,
        // Same rationale as the step-cap branch above: leads with the
        // guest's actual question so the owner knows what to answer.
        reason: `Guest asked: "${incomingMessage}" — model returned an empty reply twice in a row (a known reasoning-model reliability issue, see agent-node-behavior.md).`,
        // Same reasoning as the step-cap safety net above: deterministic,
        // not guest-driven, and missing_info is the closest of the three
        // categories — the model failed to produce a real answer for the
        // guest.
        reasonCategory: "missing_info",
        triggerMessageId,
      });

      return {
        messages: [
          ...messages,
          {
            role: "assistant",
            content:
              "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
          },
        ],
        stepCount,
        // Always missing_info for this branch (see reasonCategory above) —
        // the webhook route uses this to suppress the interim message above
        // from ever reaching the guest.
        missingInfoEscalated: true,
      };
    }

    if (result.toolCalls.length === 0) {
      // Built directly from result.text (always a plain string on
      // GenerateTextResult) rather than mutating whatever shape
      // result.response.messages happens to use for a text-only assistant
      // message — sidesteps needing to know/assert that internal AI SDK
      // representation, mirroring the old code's narrow
      // `response.content = sanitizeReplyText(response.content)` mutation.
      messages = [...messages, { role: "assistant", content: sanitizeReplyText(result.text) }];
      // NOT forced to false — sticky, see this function's own doc comment.
      return { messages, stepCount, missingInfoEscalated };
    }

    // response.messages carries this round's real assistant message (with
    // its tool-call parts), but — unlike the old AI SDK auto-dispatch
    // version of this file — no tool-result message, since none of `tools`
    // has an `execute` for generateText to run. Dispatch each call for real
    // via runToolCall() (see its own comment), in parallel same as AI SDK's
    // own per-step fan-out did, then build and append this round's
    // tool-result message ourselves, correlated by tool_call_id the same
    // way.
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
    // Loop continues — do NOT return early here, matches the old
    // tool-node -> agent edge.
  }
}
