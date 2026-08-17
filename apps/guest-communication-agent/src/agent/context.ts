import type { ModelMessage } from "ai";
import { encode } from "gpt-tokenizer";

// Token-budget-aware trimming of recent conversation history. Pure
// hydration mechanics over plain ModelMessage[] — summary orchestration
// lives in ../agent/memory.ts (loadMemory/foldMemory, via their shared
// loadMemoryState), which calls trimToTokenBudget below unchanged.

// KEEP_CONTEXT_TOKENS must stay below MAX_CONTEXT_TOKENS: trimToTokenBudget
// only trims once total tokens exceed MAX, down to KEEP — if KEEP were ever
// >= MAX, the trim loop would no-op and MAX would stop being an effective
// ceiling.
export const MAX_CONTEXT_TOKENS = 500;
export const KEEP_CONTEXT_TOKENS = 250;

// DeepSeek (this app's model, see memory.ts/run-turn.ts's MODEL) has no
// maintained JS/TS tokenizer binding, so this counts via gpt-tokenizer's
// default o200k_base BPE encoding (OpenAI's, not DeepSeek's) as the
// closest well-maintained approximation — real subword counts, not an
// exact match to DeepSeek's own vocabulary.
export function estimateTokens(messages: ModelMessage[]): number {
  return messages.reduce((n, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return n + encode(text).length;
  }, 0);
}

// If over MAX_CONTEXT_TOKENS, peels oldest messages off until back under
// KEEP_CONTEXT_TOKENS. Operates on a single freshly-fetched message list —
// every guest turn calls loadMemory fresh (and, later, foldMemory again),
// re-fetching and re-trimming from Postgres each time.
export function trimToTokenBudget(messages: ModelMessage[]): ModelMessage[] {
  if (estimateTokens(messages) <= MAX_CONTEXT_TOKENS) return messages;

  const trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > KEEP_CONTEXT_TOKENS) {
    trimmed.shift();
  }
  return trimmed;
}
