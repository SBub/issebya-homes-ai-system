import { createOpenAI } from "@ai-sdk/openai";
import { load } from "@langchain/core/load";
import * as prompts from "@langchain/core/prompts";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { Client } from "langsmith";
import { loadContext } from "@/agent/load-context";
import { checkAvailability } from "@/agent/tools/availability";
import { createSendBookingLinkTool } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { createEscalateToOwnerTool, performEscalation } from "@/agent/tools/escalation";
import { getPricing } from "@/agent/tools/pricing";
import { answerPropertyQuestion } from "@/agent/tools/property-question";

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
// (generateText, from "ai") also runs each round's tool_calls automatically
// via each tool's own `execute` — see buildAgentTools below — rather than
// this file manually dispatching them the way invokeTool() used to. This
// loop still drives the round-by-round control flow itself (stopWhen:
// stepCountIs(1) caps generateText to exactly one model call + its tool
// executions per invocation, never AI SDK's own multi-step auto-looping)
// so the step-cap/empty-reply-retry/sticky-missingInfoEscalated semantics
// below stay exactly as deliberate and inspectable as they were before.
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
// each tool's own `execute`, see buildAgentTools below). 8 gives headroom
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
// Built fresh every runAgentTurn() call (not module-level singletons) since
// sendBookingLink/escalateToOwner need this turn's conversationId/phone/
// triggerMessageId closed over — AI SDK's tool `execute` only ever receives
// { toolCallId, messages, abortSignal, experimental_context }, no arbitrary
// per-call config bag the way LangChain's RunnableConfig.configurable was,
// so closures are the natural replacement. getPricing/checkAvailability/
// answerPropertyQuestion need no per-turn context, so they stay the same
// module-level instances every turn reuses (see their own files' comments);
// only the object literal collecting all 5 into one ToolSet is rebuilt each
// call.
function buildAgentTools(context: ToolContext) {
  return {
    getPricing,
    checkAvailability,
    answerPropertyQuestion,
    sendBookingLink: createSendBookingLinkTool(context),
    escalateToOwner: createEscalateToOwnerTool(context),
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
  // buildAgentTools' closure) and run-turn.ts's own deterministic
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

  // Built once per turn — see buildAgentTools' own comment for why this
  // needs to be a closure-based factory rather than the old module-level
  // singleton tools.
  const tools = buildAgentTools({ conversationId, phone, triggerMessageId });

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

    const invokeModel = () =>
      generateText({
        model,
        system,
        messages,
        tools,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Exactly one model call + that round's own tool executions per
        // invokeModel() call — this file's own while loop drives further
        // rounds, not AI SDK's built-in multi-step auto-looping (which
        // would remove the hook this loop needs for the empty-reply-retry
        // and step-cap branches below). stepCountIs(1) is also
        // generateText's own default, but spelled out here since it's
        // load-bearing for this loop's control flow, not an incidental
        // default.
        stopWhen: stepCountIs(1),
      });

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

    // Tool calls this round already ran for real (each tool's own execute,
    // see buildAgentTools above) as part of the generateText() call itself
    // — AI SDK's automatic per-step tool dispatch replaces the old manual
    // invokeTool()/Promise.all fan-out. response.messages carries this
    // round's real assistant message (with its tool-call parts) plus the
    // matching tool-result message(s), already correlated by tool_call_id.
    messages = [...messages, ...result.response.messages];

    const escalateCall = result.toolCalls.find((call) => call.toolName === "escalateToOwner");
    const escalateArgs = escalateCall?.input as { reason_category?: string } | undefined;
    if (escalateArgs?.reason_category === "missing_info") {
      missingInfoEscalated = true;
    }
    // Loop continues — do NOT return early here, matches the old
    // tool-node -> agent edge.
  }
}
