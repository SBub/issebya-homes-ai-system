import type { ModelMessage } from "ai";

const FIRST_TURN_LINE =
  "This is the guest's first message in this conversation. Begin your reply with the AI disclosure described in your instructions.";

// The system-context line run-agent-turn.ts appends after the Braintrust
// prompt and the today line. The prompt owns the disclosure wording; this
// line only says when. Its absence on later turns is the signal, so there is
// deliberately no "not first" counterpart.
export function buildFirstTurnLine(hasAssistantHistory: boolean): string | null {
  return hasAssistantHistory ? null : FIRST_TURN_LINE;
}

// For the eval executor, which only has ModelMessage[]. Production uses
// AgentMemory.hasAssistantHistory instead (see its comment in memory.ts).
export function hasAssistantMessage(messages: ModelMessage[]): boolean {
  return messages.some((m) => m.role === "assistant");
}
