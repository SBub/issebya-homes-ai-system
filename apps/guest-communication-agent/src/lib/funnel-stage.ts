import type { ModelMessage, ToolResultPart } from "ai";
import type { FunnelStageHint } from "@/lib/crm";

// The three escalation tools (wants_human, complaint, missing_info) are
// deliberately excluded — escalation isn't part of this funnel-stage model
// and produces no hint.
const INFORMED_TOOL_NAMES = new Set(["getPricing", "checkAvailability", "answerPropertyQuestion"]);

function isToolResultPart(part: ToolResultPart | { type: string }): part is ToolResultPart {
  return part.type === "tool-result";
}

// Any `role: "tool"` message necessarily came from the current turn — loadMemory
// only ever reconstructs user/assistant messages from history.
// sendBookingLink wins ("link_sent") over any "informed" tool also firing.
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
