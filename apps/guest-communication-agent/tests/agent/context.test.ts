import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  KEEP_CONTEXT_TOKENS,
  MAX_CONTEXT_TOKENS,
  trimToTokenBudget,
} from "@/agent/context.js";

// Builds a ModelMessage with `content` padded with repeated natural-English
// filler to (at least) `chars` characters, tagged with `tag` for
// containment/ordering assertions. Real BPE tokenizers merge long runs of a
// single repeated character far more aggressively than ordinary prose (e.g.
// "x".repeat(300) is ~38 tokens, vs ~63 for 300 chars of real words), so
// this uses word-shaped filler to keep the fixture's token count
// representative of actual guest/assistant messages instead of a
// pathological outlier.
function messageOfLength(role: "user" | "assistant", chars: number, tag: string): ModelMessage {
  const phrase = "the quick brown fox jumps over the lazy dog and then trots back home again ";
  const body = `${tag}: `;
  let content = body;
  while (content.length < chars) content += phrase;
  return { role, content: content.slice(0, chars) } as ModelMessage;
}

describe("estimateTokens", () => {
  // Exact counts below are gpt-tokenizer's real o200k_base BPE token
  // counts for this exact text (not chars/4) — verified by running the
  // tokenizer directly, not derived from a formula.
  it("counts real BPE tokens for string content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Yes" } as ModelMessage,
      {
        role: "assistant",
        content:
          "Room 2 is available for those dates. It's €120 per night, with a 2-night minimum stay and free cancellation up to 48 hours before check-in.",
      } as ModelMessage,
    ];
    expect(estimateTokens(messages)).toBe(35); // 1 + 34
  });

  it("falls back to JSON.stringify length for non-string content, then tokenizes that", () => {
    const content = [{ type: "text", text: "hi" }];
    const messages: ModelMessage[] = [{ role: "user", content } as unknown as ModelMessage];
    // Real tokenizer count of the JSON.stringify'd fallback text, not
    // chars/4 — this app's ModelMessage[] content is always plain text in
    // practice (see run-agent-turn.ts's comment on GCA never sending/receiving
    // file attachments), so this branch only exists to satisfy
    // ModelMessage's `string | Array<ContentPart>` type.
    expect(estimateTokens(messages)).toBe(11);
  });

  it("returns 0 for an empty message list", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

describe("trimToTokenBudget", () => {
  it("leaves a set of many short messages untouched when comfortably under budget", () => {
    // 20 short messages (~13 tokens each -> 260 tokens total), nowhere near
    // MAX_CONTEXT_TOKENS (1600).
    const messages = Array.from({ length: 20 }, (_, i) => messageOfLength("user", 50, `m${i}`));

    expect(estimateTokens(messages)).toBeLessThan(MAX_CONTEXT_TOKENS);

    const trimmed = trimToTokenBudget(messages);

    expect(trimmed).toEqual(messages);
    expect(trimmed).toHaveLength(20);
  });

  it("trims a set of few very long messages down to under KEEP_CONTEXT_TOKENS, dropping oldest first", () => {
    // 8 long messages (1100 chars -> 223 real tokens each -> 1784 tokens
    // total), just over MAX_CONTEXT_TOKENS (1600). Only the most recent 3
    // (669 tokens) fit under KEEP_CONTEXT_TOKENS (800) — the newest 4 would
    // be 892, over budget.
    const messages = Array.from({ length: 8 }, (_, i) => messageOfLength("user", 1100, `m${i}`));

    expect(estimateTokens(messages)).toBeGreaterThan(MAX_CONTEXT_TOKENS);

    const trimmed = trimToTokenBudget(messages);

    expect(estimateTokens(trimmed)).toBeLessThanOrEqual(KEEP_CONTEXT_TOKENS);
    expect(trimmed).toHaveLength(3);
    // Oldest dropped first: the survivors are the tail of the original
    // array, in original (oldest-first-among-survivors) order.
    expect(trimmed).toEqual(messages.slice(5));
  });

  it("never trims below a single message, even if that message alone is over budget", () => {
    const messages = [messageOfLength("user", 20000, "huge")];

    const trimmed = trimToTokenBudget(messages);

    expect(trimmed).toHaveLength(1);
    expect(trimmed).toEqual(messages);
  });
});
