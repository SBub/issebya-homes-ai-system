import { load } from "@langchain/core/load";
import { AIMessage } from "@langchain/core/messages";
import * as prompts from "@langchain/core/prompts";
import type { RunnableConfig } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { Client } from "langsmith";
import type { GraphStateType } from "@/graph/state";
import { agentTools, performEscalation } from "@/graph/tools";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/graph/nodes/agent.ts — no import path
// changes needed, this file has no dependency on the inlined
// shared-package factories.

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

// Deterministic ceiling on reasoning rounds (agent-node executions, not tool
// calls — one round can dispatch several tool calls in parallel, see
// tool-nodes.ts). This port has no equivalent LangGraph helper, so it's
// enforced by hand here instead of relying on LangGraph's own default
// `recursionLimit: 25` — that default counts every node visit (agent +
// every tool node), throws an unhandled GraphRecursionError rather than
// ending the turn gracefully, and isn't sized for this graph's shape at
// all. 8 gives headroom for all 5 tools to each be tried once, plus 2
// retry/reformulation rounds, plus 1 final text-only round.
const MAX_AGENT_STEPS = 8;

// Module-level client, reused across turns/invocations. Also owns
// pullPromptCommit's internal per-identifier cache, so repeated pulls within
// a single tool-calling loop are cheap.
const langsmithClient = new Client({ apiKey: process.env.LANGSMITH_API_KEY });

// Configured for OpenRouter.
//
// maxTokens is explicit because MODEL is a reasoning model — its internal
// "thinking" tokens count against the same completion budget as the visible
// reply, not a separate allowance. Confirmed via a real trace: on a hard,
// ambiguous prompt, the model spent its entire (unset-default, apparently
// very small) completion budget on reasoning and returned a literal empty
// string as the reply (finish_reason: "stop", content: "", with
// output_token_details.reasoning equal to the full completion token count).
// A tighter prompt rule reduced reasoning tokens spent on that same case
// (41 -> 21) but didn't fix it alone — the ceiling was still too low for
// any reasoning plus a real answer to both fit. 1000 gives real headroom
// for both on top of a typical short conversational reply.
const model = new ChatOpenAI({
  model: MODEL,
  apiKey: process.env.OPENROUTER_API_KEY,
  maxTokens: 1000,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
}).bindTools(agentTools);

// Pulls the `whatsapp-booking-agent` prompt from LangSmith's Prompt Hub and
// deserializes its manifest into a real, invokable ChatPromptTemplate.
// pullPromptCommit() returns the manifest as a plain LangChain-serialized
// object graph, not a ready-to-use object — load() does the deserialization.
// It needs an explicit importMap: the manifest's class id is namespaced under
// "langchain" rather than "langchain_core" (the only namespace @langchain/core
// resolves for free), so the "prompts" module has to be supplied by hand or
// load() throws "Invalid namespace".
async function pullSystemPromptTemplate() {
  const commit = await langsmithClient.pullPromptCommit(SYSTEM_PROMPT_IDENTIFIER);
  const promptTemplate = await load<prompts.ChatPromptTemplate>(JSON.stringify(commit.manifest), {
    importMap: { prompts },
  });
  return {
    promptTemplate,
    promptCommitMetadata: {
      promptOwner: commit.owner,
      promptRepo: commit.repo,
      promptCommitHash: commit.commit_hash,
    },
  };
}

// The prompt's "no em dash" / "no bold" rules are purely mechanical,
// deterministic constraints (unlike scope discipline or tool selection,
// which need real judgment) — but the model doesn't follow them 100% of the
// time regardless. Enforcing both in code guarantees compliance instead of
// hoping the instructions stick. Bold stripping keeps the wrapped text, only
// removes the asterisks — "**Hairdryer**"/"*Hairdryer*" both become
// "Hairdryer" rather than being deleted outright.
function sanitizeReplyText(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

// Tools are module-level (see ../tools.ts) and read conversationId/phone off
// `config.configurable` rather than a closure. LangGraph threads whatever
// config the graph was `.invoke()`d with to every node — including the
// prebuilt ToolNode that executes tool calls this node emits — so the
// caller of the compiled graph must invoke it with
// `{configurable: {conversationId, phone}}` alongside the state input.
// Forwarding `config` into this node's own model.invoke() call (rather than
// re-deriving a fresh configurable object from state) keeps that a single
// source of truth and preserves LangSmith trace nesting/tags.
export async function agentNode(
  state: GraphStateType,
  config: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const stepCount = (state.stepCount ?? 0) + 1;

  // Safety net for pathological cases (a tool that keeps failing, a model
  // that won't stop retrying/reformulating, etc.) — not a change to normal
  // behavior. A typical turn resolves in 1-2 rounds and never comes near
  // this branch. When it does, skip the model call entirely (no LLM
  // latency, no chance of yet another tool_calls response looping this
  // further) and perform a real escalation — the same DB insert + Telegram
  // notification `escalateToOwner` gives the model when it chooses to
  // escalate itself, just triggered deterministically instead of by the
  // model's own judgment.
  if (stepCount > MAX_AGENT_STEPS) {
    const { conversationId, phone } = state;
    await performEscalation({
      conversationId,
      phone,
      reason: `Agent reasoning loop exceeded ${MAX_AGENT_STEPS} rounds without reaching a final answer.`,
    });

    return {
      messages: [
        new AIMessage(
          "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
        ),
      ],
      stepCount,
    };
  }

  const { messages, guestContext } = state;

  // guestContext now holds past-stay facts from guest_contacts (see
  // load-context.ts/db.ts's loadGuestInfo) rather than CRM campaign context —
  // still guest-specific background the model should be aware of either way.
  // Plain content only — the prompt template itself owns the <guest_memory>
  // XML wrapper around {guest_memory_block} (so a reader of the raw template
  // can see where the tag rule 9 references actually comes from, rather than
  // it only existing because application code happened to add it).
  const guestMemoryBlock = guestContext ?? "No prior guest information available.";

  const { promptTemplate, promptCommitMetadata } = await pullSystemPromptTemplate();
  const promptValue = await promptTemplate.invoke({
    guest_memory_block: guestMemoryBlock,
  });
  const [systemMessage] = promptValue.toChatMessages();

  const invokeModel = () =>
    model.invoke([systemMessage, ...messages], {
      ...config,
      metadata: { ...config.metadata, ...promptCommitMetadata },
    });

  let response = await invokeModel();

  // MODEL is a reasoning model — confirmed via real traces that it can
  // return a genuinely empty reply (content: "", tool_calls: [],
  // finish_reason: "stop") on a hard/ambiguous turn, having spent its whole
  // completion budget on internal reasoning with nothing left for visible
  // output. One retry first, since it isn't fully deterministic; if it
  // recurs, treat it the same as the MAX_AGENT_STEPS case — skip straight to
  // a real escalation rather than sending the guest nothing.
  const isEmpty = (r: typeof response) =>
    (typeof r.content !== "string" || r.content.trim() === "") &&
    (!r.tool_calls || r.tool_calls.length === 0);

  if (isEmpty(response)) {
    response = await invokeModel();
  }

  if (isEmpty(response)) {
    const { conversationId, phone } = state;
    await performEscalation({
      conversationId,
      phone,
      reason:
        "Model returned an empty reply twice in a row (a known reasoning-model reliability issue, see agent-node-behavior.md).",
    });

    return {
      messages: [
        new AIMessage(
          "I'm having trouble finding a complete answer for you right now. I've let the owner know and they'll follow up with you shortly.",
        ),
      ],
      stepCount,
    };
  }

  if (typeof response.content === "string") {
    response.content = sanitizeReplyText(response.content);
  }

  return { messages: [response], stepCount };
}
