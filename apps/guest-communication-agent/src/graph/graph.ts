import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { agentNode } from "@/graph/nodes/agent";
import { loadContext } from "@/graph/nodes/load-context";
import {
  answerPropertyQuestionNode,
  checkAvailabilityNode,
  escalateToOwnerNode,
  getPricingNode,
  routeToToolNodes,
  sendBookingLinkNode,
  TOOL_NODE_NAMES,
} from "@/graph/nodes/tool-nodes";
import { GraphState } from "@/graph/state";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/graph/graph.ts — no import path
// changes needed.
//
// Stateless per-invocation: the caller passes conversationId/phone/
// incomingMessage every turn (with `messages` left empty — see state.ts for
// why), and load_context loads recent history + guest info fresh from
// Postgres (whatsapp_messages/whatsapp_conversations/guest_contacts, via
// @/lib/db.ts's createAdminClient()), which stays the system of record —
// not this graph. The caller must also pass `{configurable: {conversationId, phone}}`
// in the invoke config so tool nodes can read it (see nodes/agent.ts).
//
//   START -> load_context -> agent <-> {getPricingStub, checkAvailability,
//     sendBookingLink, answerPropertyQuestion, escalateToOwner} -> END
//
// Each tool gets its own named node (see nodes/tool-nodes.ts for why a single
// shared ToolNode/`tools` box isn't safe here) so a graph visualization shows
// which specific tool fired instead of one collapsed generic "tools" box.
// routeToToolNodes fans out to every tool the model called in a turn
// (returning a string[] triggers parallel fan-out), or to END when there are
// no tool calls — the same default `toolsCondition` used.
//
// getPricing's node id is 'getPricingStub', not 'getPricing': the tool
// itself (tools.ts) still reads a hardcoded PRICING constant rather than a
// real pricing source, so its node is named to make that visible at a
// glance. The tool's own LLM-facing name stays 'getPricing' — see
// TOOL_NAME_TO_NODE_NAME in nodes/tool-nodes.ts for how routeToToolNodes
// maps the tool_call name to this node id.
const builder = new StateGraph(GraphState)
  .addNode("load_context", loadContext)
  .addNode("agent", agentNode)
  .addNode("getPricingStub", getPricingNode)
  .addNode("checkAvailability", checkAvailabilityNode)
  .addNode("sendBookingLink", sendBookingLinkNode)
  .addNode("answerPropertyQuestion", answerPropertyQuestionNode)
  .addNode("escalateToOwner", escalateToOwnerNode)
  .addEdge(START, "load_context")
  .addEdge("load_context", "agent")
  .addConditionalEdges("agent", routeToToolNodes, [...TOOL_NODE_NAMES, END])
  .addEdge("getPricingStub", "agent")
  .addEdge("checkAvailability", "agent")
  .addEdge("sendBookingLink", "agent")
  .addEdge("answerPropertyQuestion", "agent")
  .addEdge("escalateToOwner", "agent");

// A MemorySaver checkpointer is only needed for interactive LangGraph
// Studio debugging — it is NOT the persistence layer for production.
// Postgres remains the system of record; this in-memory checkpoint is
// ephemeral and scoped to a single debugging session.
export const graph = builder.compile({ checkpointer: new MemorySaver() });
