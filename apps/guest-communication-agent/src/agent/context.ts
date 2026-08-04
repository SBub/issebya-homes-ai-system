import type { ModelMessage } from "ai";

// Context hydration mechanics: token-budget-aware trimming of recent
// conversation history, replacing the old hard row-count cliff
// (RECENT_MESSAGE_LIMIT in ../lib/db.ts). Ported from
// harness-engineering/harness/memory.ts's estimateTokens/
// MAX_CONTEXT_TOKENS/KEEP_CONTEXT_TOKENS and the "peel oldest until back
// under KEEP" compaction shape in that project's runtime.ts, adapted to
// GCA's per-turn re-fetch-and-trim model — see trimToTokenBudget below.
//
// This file is also the intended home for step 2 (persistent agent
// memory — a guest_memory-backed rolling summary) once that's scoped and
// built; see the injection seam left in load-context.ts. Nothing here
// fetches, generates, or writes a summary yet — this step is scoped to
// hydration mechanics only.

// Placeholder/demo-scale values copied directly from the reference
// project (harness-engineering/harness/memory.ts), not yet tuned for GCA's
// real usage or MODEL's (src/agent/run-turn.ts) actual context window.
// Real tuning against GCA's own conversation-length data is deferred — see
// TASK_FOR_TOMORROW.md.
export const MAX_CONTEXT_TOKENS = 3000;
export const KEEP_CONTEXT_TOKENS = 1500;

// Same rough chars/4 estimate as the reference — cheap and good enough to
// drive a trim decision, not meant to be an exact tokenizer match.
export function estimateTokens(messages: ModelMessage[]): number {
  const chars = messages.reduce(
    (n, m) =>
      n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
    0,
  );
  return Math.ceil(chars / 4);
}

// Mirrors the reference's compaction loop shape (harness/runtime.ts's
// agentWorkflow: "if over MAX_CONTEXT_TOKENS, peel oldest turns off until
// back under KEEP_CONTEXT_TOKENS") but operates on a single freshly-fetched
// message list rather than an in-memory turns[] accumulator that persists
// across steps. GCA has no equivalent accumulator — every guest turn calls
// loadContext fresh, re-fetching and re-trimming recent history from
// Postgres each time (Postgres remains the system of record either way),
// which is fine and expected here.
export function trimToTokenBudget(messages: ModelMessage[]): ModelMessage[] {
  if (estimateTokens(messages) <= MAX_CONTEXT_TOKENS) return messages;

  const trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > KEEP_CONTEXT_TOKENS) {
    trimmed.shift();
  }
  return trimmed;
}
