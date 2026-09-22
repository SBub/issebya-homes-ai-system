import type { ModelMessage, ToolResultPart } from "ai";

// The shape stored in whatsapp_messages.turn_messages: one guest turn's own
// AI SDK messages, replayed verbatim as history on later turns (memory.ts).
// Pure, no I/O, so both run-guest-turn.ts (write) and memory.ts (read) can
// import it without a cycle.

// Versioned because the SDK has renamed these fields before (`args` ->
// `input`); db.ts treats any other version as null, so a stored shape this
// code no longer understands degrades to text-only replay.
export const TURN_MESSAGES_SCHEMA_VERSION = 1;

export interface StoredTurnMessages {
  schema_version: typeof TURN_MESSAGES_SCHEMA_VERSION;
  messages: ModelMessage[];
}

// Caps one tool's result as replayed from a previous turn. Tool-call inputs
// are the facts the model acted on and are never truncated. The truncated
// form is type "text" because a cut JSON string is no longer valid JSON.
const TOOL_OUTPUT_MAX_CHARS = 2000;

function serializeToolOutput(output: ToolResultPart["output"]): string | null {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value;
    case "json":
    case "error-json":
      return JSON.stringify(output.value);
    default:
      return null;
  }
}

function truncateToolResult(part: ToolResultPart): ToolResultPart {
  const serialized = serializeToolOutput(part.output);
  if (serialized === null || serialized.length <= TOOL_OUTPUT_MAX_CHARS) return part;
  const total = serialized.length;
  return {
    ...part,
    output: {
      type: "text",
      value: `${serialized.slice(0, TOOL_OUTPUT_MAX_CHARS)}…[truncated ${total - TOOL_OUTPUT_MAX_CHARS} of ${total} chars; call the tool again for the full output]`,
    },
  };
}

export function truncateToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result" ? truncateToolResult(part) : part,
      ),
    };
  });
}

// Keeps assistant text/tool-call parts and tool messages; drops reasoning
// and anything else, which the next turn doesn't need and would only eat
// the token budget.
function keepReplayableParts(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "tool") return [message];
    if (message.role !== "assistant") return [];
    if (typeof message.content === "string") return [message];
    const content = message.content.filter(
      (part) => part.type === "text" || part.type === "tool-call",
    );
    return content.length > 0 ? [{ ...message, content }] : [];
  });
}

// LANDMINE: every stored array must be self-contained, ending in assistant
// text with every tool-call answered by its tool-result. memory.ts replays
// these arrays as-is and interleaves them with other rows, and a provider
// rejects a dangling tool-call with a 400. The step-cap path ends on a tool
// message, so the reply text is appended here.
export function finalizeTurnMessages(tail: ModelMessage[], replyText: string): StoredTurnMessages {
  const messages = truncateToolOutputs(keepReplayableParts(tail));
  const last = messages.at(-1);
  if (!(last?.role === "assistant" && typeof last.content === "string")) {
    messages.push({ role: "assistant", content: replyText });
  }
  return { schema_version: TURN_MESSAGES_SCHEMA_VERSION, messages };
}
