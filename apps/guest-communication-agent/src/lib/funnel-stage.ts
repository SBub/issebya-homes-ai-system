import type { ModelMessage, ToolResultPart } from "ai";
import type { FunnelStageHint } from "@/lib/crm";

// The three escalation tools (wants_human, complaint, missing_info) are
// deliberately excluded — escalation isn't part of this funnel-stage model
// and produces no hint.
const INFORMED_TOOL_NAMES = new Set(["getPricing", "checkAvailability", "answerPropertyQuestion"]);

function isToolResultPart(part: ToolResultPart | { type: string }): part is ToolResultPart {
  return part.type === "tool-result";
}

/**
 * Pure extraction of a funnel-stage hint from a turn's messages. Only looks
 * at `role: "tool"` entries; since loadMemory (@/agent/memory.ts) only ever
 * reconstructs user/assistant messages from history, any tool message
 * present necessarily came from the current runAgentTurn() call.
 *
 * Precedence: sendBookingLink firing at all wins ("link_sent") even if an
 * "informed" tool also fired this turn. Otherwise any one of the "informed"
 * tools yields "informed". No matching tool call returns undefined — the
 * caller still calls touchGuestContact with no stageHint, purely to bump
 * last_interaction_at.
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
