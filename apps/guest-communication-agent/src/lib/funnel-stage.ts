import { type BaseMessage, isToolMessage } from "@langchain/core/messages";
import type { FunnelStageHint } from "@/lib/crm";

// Tool names that imply the guest has been informed about the property (as
// opposed to escalateToOwner, which isn't part of this funnel-stage model
// and deliberately produces no stageHint). These are the tools' real,
// LLM-facing `name`s (tools.ts) — NOT their graph node ids, which differ
// for getPricing (node id 'getPricingStub', tool name 'getPricing'; see
// tool-nodes.ts's own doc comment). ToolMessage.name is always the tool
// name, never the node id, so this set is correct regardless of node
// wiring.
const INFORMED_TOOL_NAMES = new Set(["getPricing", "checkAvailability", "answerPropertyQuestion"]);

/**
 * Pure, testable extraction of a funnel-stage hint from a turn's messages.
 * Callers (currently the whatsapp webhook route) pass `result.messages`
 * straight from `graph.invoke(...)` — this only ever looks at ToolMessage
 * entries within it (via isToolMessage), never AIMessage/HumanMessage, so it
 * is agnostic to how much prior conversation history sits alongside them in
 * the same array.
 *
 * Note: this graph reconstructs conversation history fresh from Postgres
 * every turn (see load-context.ts), and that reconstruction only ever
 * produces HumanMessage/AIMessage from stored "user"/"assistant" rows —
 * never ToolMessage. So every ToolMessage present in `messages` at the time
 * this is called necessarily comes from tool nodes that ran during the
 * current graph.invoke() call, not a prior turn.
 *
 * Precedence, per the funnel-stage spec: sendBookingLink firing at all this
 * turn always wins ("link_sent"), even if getPricing/checkAvailability/
 * answerPropertyQuestion also fired in the same turn. Otherwise, any one of
 * those three "informed" tools firing yields "informed". escalateToOwner
 * firing produces no hint either way — escalation isn't part of this
 * funnel-stage model. No matching tool at all (or no tool call this turn)
 * returns undefined — the caller still calls touchGuestContact with no
 * stageHint in that case, purely to bump last_interaction_at.
 */
export function deriveStageHint(messages: BaseMessage[]): FunnelStageHint | undefined {
  const toolNames = new Set(messages.filter(isToolMessage).map((message) => message.name));

  if (toolNames.has("sendBookingLink")) {
    return "link_sent";
  }

  for (const name of INFORMED_TOOL_NAMES) {
    if (toolNames.has(name)) {
      return "informed";
    }
  }

  return undefined;
}
