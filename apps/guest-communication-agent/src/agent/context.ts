import type { ModelMessage } from "ai";

// Token-budget-aware trimming of recent conversation history. Pure
// hydration mechanics over plain ModelMessage[] — summary orchestration
// lives in ../agent/memory.ts (loadMemory), which calls trimToTokenBudget
// below unchanged.

// KEEP_CONTEXT_TOKENS must stay below MAX_CONTEXT_TOKENS: trimToTokenBudget
// only trims once total tokens exceed MAX, down to KEEP — if KEEP were ever
// >= MAX, the trim loop would no-op and MAX would stop being an effective
// ceiling.
export const MAX_CONTEXT_TOKENS = 500;
export const KEEP_CONTEXT_TOKENS = 250;

// Rough chars/4 estimate — cheap and good enough to drive a trim decision,
// not an exact tokenizer match.
export function estimateTokens(messages: ModelMessage[]): number {
  const chars = messages.reduce(
    (n, m) =>
      n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
    0,
  );
  return Math.ceil(chars / 4);
}

// If over MAX_CONTEXT_TOKENS, peels oldest messages off until back under
// KEEP_CONTEXT_TOKENS. Operates on a single freshly-fetched message list —
// every guest turn calls loadMemory fresh, re-fetching and re-trimming from
// Postgres each time.
export function trimToTokenBudget(messages: ModelMessage[]): ModelMessage[] {
  if (estimateTokens(messages) <= MAX_CONTEXT_TOKENS) return messages;

  const trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > KEEP_CONTEXT_TOKENS) {
    trimmed.shift();
  }
  return trimmed;
}
