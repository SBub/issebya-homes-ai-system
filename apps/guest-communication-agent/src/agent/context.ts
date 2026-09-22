import type { ModelMessage } from "ai";
import { encode } from "gpt-tokenizer";

// Token-budget-aware trimming of recent conversation history. Pure
// hydration mechanics over turn groups of ModelMessage — summary
// orchestration and turn grouping live in ../agent/memory.ts
// (loadMemory/foldMemory, via their shared loadMemoryState).

// KEEP_CONTEXT_TOKENS must stay below MAX_CONTEXT_TOKENS: trimToTokenBudget
// only trims once total tokens exceed MAX, down to KEEP — if KEEP were ever
// >= MAX, the trim loop would no-op and MAX would stop being an effective
// ceiling.
//
// Sized by conversation shape: ~10 turns with 1-2 tool rounds each, tool
// results capped at 2,000 chars (turn-messages.ts), fit in 6000. The model
// (deepseek-v4-pro over OpenRouter) has a 1M context at ~$0.88/M input
// tokens, so this costs under a cent per turn.
export const MAX_CONTEXT_TOKENS = 8000;
export const KEEP_CONTEXT_TOKENS = 6000;

// DeepSeek (this app's model, see run-model.ts's MODEL) has no
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

// If over MAX_CONTEXT_TOKENS, peels the oldest turn groups off until back
// under KEEP_CONTEXT_TOKENS. Drops whole groups only, never a message from
// inside one: splitting a group can orphan a tool-call from its
// tool-result, which the provider rejects with a 400. The last group (the
// current turn's incoming message) is never dropped. Every guest turn calls
// loadMemory fresh (and, later, foldMemory again), re-fetching and
// re-trimming from Postgres each time.
export function trimToTokenBudget(groups: ModelMessage[][]): ModelMessage[][] {
  if (estimateTokens(groups.flat()) <= MAX_CONTEXT_TOKENS) return groups;

  const trimmed = [...groups];
  while (trimmed.length > 1 && estimateTokens(trimmed.flat()) > KEEP_CONTEXT_TOKENS) {
    trimmed.shift();
  }
  return trimmed;
}
