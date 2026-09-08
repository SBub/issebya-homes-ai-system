import type { ModelMessage } from "ai";

// Shared shapes between executors.ts (the task) and evaluators.ts (the
// scorers) — this dataset row's `input` shape (messages so far, including
// this turn's newest guest message last, plus the rolling memory summary
// that feeds the system prompt's {guest_memory_block}).
export interface EvalInput {
  messages: ModelMessage[];
  contextBlock: string;
}

export interface ToolCallInfo {
  toolName: string;
  args: Record<string, unknown>;
}

// executors.ts's singleTurnWithMocks output: every tool call the model
// requested in its one real generateText round (usually 0 or 1, but the
// API allows several in parallel), plus whatever text it returned instead
// of/alongside them.
export interface SingleTurnResult {
  toolCalls: ToolCallInfo[];
  toolNames: string[];
  text: string;
}

// This dataset's real `expected` field, one to one. Pure oracle data only —
// no prose; the row's human-readable summary lives in dataset metadata's
// `description` instead, not part of `expected`.
export interface ExpectedShape {
  toolCall: { name: string; args?: Record<string, unknown> } | null;
  expectedAlternative: string | null;
}
