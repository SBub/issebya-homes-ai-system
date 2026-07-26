import type { ToolMessage } from "@langchain/core/messages";
import { isAIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END } from "@langchain/langgraph";
import type { GraphStateType } from "@/graph/state";
import { agentTools } from "@/graph/tools";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/graph/nodes/tool-nodes.ts — no import
// path changes needed.
//
// Why not just `new ToolNode(tool)` per tool (5 instances)? ToolNode.run()
// does NOT accept "run just this one tool_call" — it re-derives the FULL
// tool_calls array off the last AIMessage every time it runs, and for each
// call in that array (not just ones belonging to `this.tools`) it calls
// `runTool`, which does `this.tools.find((t) => t.name === call.name)` and,
// if not found, throws `Tool "${call.name}" not found.` — a throw that
// `runTool`'s own try/catch immediately downgrades (by default
// `handleToolErrors: true`) into an *error* ToolMessage rather than
// propagating or skipping. So a ToolNode scoped to only `getPricing` does
// not ignore an unrelated `checkAvailability` call sitting in the same
// AIMessage — it still "handles" it, just badly (a bogus "not found" error
// message). That's fatal for fan-out: when the model calls two tools in one
// turn (the router below fans out to every matching node), routing to both
// the `getPricing` node and the `checkAvailability` node means *each* of
// those two ToolNode instances would independently process *both*
// tool_calls — one for real, one as a fabricated "not found" error —
// yielding two ToolMessages for the same tool_call_id. Message lists with a
// duplicated tool_call_id break the next model call. Hence: small custom
// node functions below, each of which only ever looks up and invokes the
// one tool_call it owns.
function findOwnToolCall(state: GraphStateType, toolName: string) {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !isAIMessage(lastMessage)) {
    throw new Error(
      `${toolName} node invoked but the last message in state is not an AIMessage with tool_calls.`,
    );
  }
  const call = lastMessage.tool_calls?.find((c) => c.name === toolName);
  if (!call) {
    throw new Error(
      `${toolName} node invoked but no matching tool_call was found on the last AIMessage — the router in tool-nodes.ts routed here incorrectly.`,
    );
  }
  return call;
}

// Builds a node function scoped to exactly one tool. `tool.invoke({...call,
// type: 'tool_call'}, config)` is the same call shape ToolNode itself uses
// (see runTool() above) — passing the ToolCall shape (rather than just
// `call.args`) makes the underlying StructuredTool auto-wrap the result in a
// ToolMessage with the right `tool_call_id`/`name`.
//
// conversationId/phone are merged into config.configurable HERE, from
// `state` (which this node already receives to find its own tool_call),
// rather than requiring the graph's caller to separately supply a
// `configurable` block at invoke time. LangGraph Studio in particular has no
// obviously-discoverable UI for setting `configurable` — merging from state
// here means the Input panel's `Phone`/`ConversationId` fields are the ONLY
// place a Studio user needs to fill these in; whatever they typed there is
// what tools receive too. A caller-supplied `config.configurable` (if any)
// still wins over state on key collision, so a real production caller can
// still override this if it ever needs to.
function makeToolNode(tool: StructuredToolInterface) {
  return async function toolNode(
    state: GraphStateType,
    config: RunnableConfig,
  ): Promise<Partial<GraphStateType>> {
    const call = findOwnToolCall(state, tool.name);
    const message = (await tool.invoke(
      { ...call, type: "tool_call" },
      {
        ...config,
        configurable: {
          conversationId: state.conversationId,
          phone: state.phone,
          ...config.configurable,
        },
      },
    )) as ToolMessage;
    return { messages: [message] };
  };
}

function getToolByName(name: string): StructuredToolInterface {
  const found = agentTools.find((t) => t.name === name);
  if (!found) {
    throw new Error(
      `Tool "${name}" not found in agentTools (tools.ts) — TOOL_NODE_NAMES/graph wiring is out of sync with tools.ts.`,
    );
  }
  return found;
}

// One named node function per tool, wired individually in graph.ts so
// LangGraph Studio renders each as its own labeled box instead of a single
// collapsed "tools" node.
//
// getPricingNode is registered in graph.ts under the node id
// 'getPricingStub' (not 'getPricing') — but it must still be built from
// getToolByName('getPricing') / makeToolNode(tool), since findOwnToolCall
// inside makeToolNode searches state.messages for a tool_call whose `name`
// is the tool's real, LLM-facing identity ('getPricing'), never the node id.
export const getPricingNode = makeToolNode(getToolByName("getPricing"));
export const checkAvailabilityNode = makeToolNode(getToolByName("checkAvailability"));
export const sendBookingLinkNode = makeToolNode(getToolByName("sendBookingLink"));
export const answerPropertyQuestionNode = makeToolNode(getToolByName("answerPropertyQuestion"));

// escalateToOwnerNode can't be built via makeToolNode like the other four —
// makeToolNode's factory only ever returns `{ messages: [message] }`, with
// no way to inspect the tool call's own args afterward. This node needs to
// do exactly that: escalateToOwner is the only tool whose outcome should
// ever suppress the guest-facing reply (see state.ts's missingInfoEscalated
// doc comment and the webhook route that consumes it), and whether it
// should is only knowable from `call.args.reason_category` — a
// missing_info escalation means the guest hears nothing until the owner
// answers and ../lib/resume-conversation.ts's proactive re-invocation sends
// the real one; the other two categories (wants_human/complaint) are
// unaffected and keep sending whatever the model composed.
// Otherwise identical to makeToolNode's own tool-invocation shape: same
// findOwnToolCall lookup, same tool.invoke() call shape, same
// conversationId/phone -> config.configurable merge (state wins by default,
// caller-supplied config.configurable still overrides on key collision).
const escalateToOwnerTool = getToolByName("escalateToOwner");

export async function escalateToOwnerNode(
  state: GraphStateType,
  config: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const call = findOwnToolCall(state, escalateToOwnerTool.name);
  const message = (await escalateToOwnerTool.invoke(
    { ...call, type: "tool_call" },
    {
      ...config,
      configurable: {
        conversationId: state.conversationId,
        phone: state.phone,
        ...config.configurable,
      },
    },
  )) as ToolMessage;
  return {
    messages: [message],
    missingInfoEscalated: call.args.reason_category === "missing_info",
  };
}

type ToolNodeName =
  | "getPricingStub"
  | "checkAvailability"
  | "sendBookingLink"
  | "answerPropertyQuestion"
  | "escalateToOwner";

// All possible destinations a tool_call can route to — used both as the
// conditional edge's explicit pathMap (so Studio can statically draw every
// edge agent->toolNode, not just the one taken on a given run) and to wire
// each node's addEdge(name, 'agent') return loop in graph.ts.
export const TOOL_NODE_NAMES: ToolNodeName[] = [
  "getPricingStub",
  "checkAvailability",
  "sendBookingLink",
  "answerPropertyQuestion",
  "escalateToOwner",
];

// Maps a tool_call's `name` (the LLM-facing tool identity from tools.ts,
// e.g. 'getPricing') to the graph node id it should route to. For every
// tool except getPricing, the node id is identical to the tool name. Only
// getPricing is split: `getPricing`'s tool.invoke()/model-facing name must
// stay 'getPricing' (see tools.ts), but its graph node id is renamed to
// 'getPricingStub' so LangGraph Studio's visualization makes it obvious
// this node still returns hardcoded PRICING data rather than reading from
// a real pricing source.
const TOOL_NAME_TO_NODE_NAME: Record<string, ToolNodeName> = {
  getPricing: "getPricingStub",
  checkAvailability: "checkAvailability",
  sendBookingLink: "sendBookingLink",
  answerPropertyQuestion: "answerPropertyQuestion",
  escalateToOwner: "escalateToOwner",
};

// Replaces `toolsCondition` (@langchain/langgraph/prebuilt), which only
// knows about a single generic `tools` destination. Maps every tool_call in
// the last AIMessage to its owning node name (via TOOL_NAME_TO_NODE_NAME,
// since tool name and node id are no longer always identical) and returns
// the whole list — LangGraph's conditional-edge routing function may return
// a string[] to fan out to multiple nodes in parallel, which is exactly
// what's needed when the model calls more than one tool in a single turn.
// Falls back to END when there are no tool calls, same default behavior as
// `toolsCondition`.
export function routeToToolNodes(state: GraphStateType): ToolNodeName[] | typeof END {
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !isAIMessage(lastMessage) || !lastMessage.tool_calls?.length) {
    return END;
  }
  return lastMessage.tool_calls.map((call) => {
    const nodeName = TOOL_NAME_TO_NODE_NAME[call.name];
    if (!nodeName) {
      throw new Error(
        `routeToToolNodes: no node mapped for tool_call name "${call.name}" — add it to TOOL_NAME_TO_NODE_NAME in tool-nodes.ts.`,
      );
    }
    return nodeName;
  });
}
