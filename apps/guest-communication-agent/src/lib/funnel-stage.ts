import type { ModelMessage, ToolResultPart } from "ai";
import type { FunnelStageHint } from "@/lib/crm";

// Tool names that imply the guest has been informed about the property (as
// opposed to escalateToOwner, which isn't part of this funnel-stage model
// and deliberately produces no stageHint). These are the tools' real,
// LLM-facing names — the Record key each tool is registered under in
// run-turn.ts's module-level `tools` ToolSet (AI SDK's ToolSet has no
// separate node-id concept the way the old LangGraph port did, so there is
// nothing else this could mean).
const INFORMED_TOOL_NAMES = new Set(["getPricing", "checkAvailability", "answerPropertyQuestion"]);

function isToolResultPart(part: ToolResultPart | { type: string }): part is ToolResultPart {
  return part.type === "tool-result";
}

/**
 * Pure, testable extraction of a funnel-stage hint from a turn's messages.
 * Callers (currently the whatsapp webhook route) pass `result.messages`
 * straight from `runAgentTurn(...)` — this only ever looks at
 * `role: "tool"` entries within it, never user/assistant messages, so it is
 * agnostic to how much prior conversation history sits alongside them in the
 * same array.
 *
 * Note: the agent reconstructs conversation history fresh from Postgres
 * every turn (see @/agent/load-context.ts), and that reconstruction only ever
 * produces user/assistant messages from stored "user"/"assistant" rows —
 * never a tool message. So every tool message present in `messages` at the
 * time this is called necessarily comes from tool calls that ran during the
 * current runAgentTurn() call, not a prior turn.
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
export function deriveStageHint(messages: ModelMessage[]): FunnelStageHint | undefined {
  const toolNames = new Set(
    messages
      .filter((message) => message.role === "tool")
      .flatMap((message) => message.content.filter(isToolResultPart).map((part) => part.toolName)),
  );

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
