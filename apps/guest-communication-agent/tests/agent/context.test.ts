import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  KEEP_CONTEXT_TOKENS,
  MAX_CONTEXT_TOKENS,
  trimToTokenBudget,
} from "@/agent/context.js";

// Builds a ModelMessage with `content` repeated/padded to exactly `chars`
// characters, so token counts in these tests are exact and easy to reason
// about (estimateTokens is chars/4, rounded up).
function messageOfLength(role: "user" | "assistant", chars: number, tag: string): ModelMessage {
  const body = `${tag}:`;
  const content = body + "x".repeat(Math.max(0, chars - body.length));
  return { role, content } as ModelMessage;
}

describe("estimateTokens", () => {
  it("estimates ~chars/4, rounded up, for string content", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a".repeat(400) } as ModelMessage,
      { role: "assistant", content: "b".repeat(1) } as ModelMessage,
    ];
    // 400 chars -> 100 tokens, 1 char -> ceil(1/4) = 1 token.
    expect(estimateTokens(messages)).toBe(101);
  });

  it("falls back to JSON.stringify length for non-string content", () => {
    const content = [{ type: "text", text: "hi" }];
    const messages: ModelMessage[] = [{ role: "user", content } as unknown as ModelMessage];
    expect(estimateTokens(messages)).toBe(Math.ceil(JSON.stringify(content).length / 4));
  });

  it("returns 0 for an empty message list", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

describe("trimToTokenBudget", () => {
  it("leaves a set of many short messages untouched when comfortably under budget", () => {
    // 20 short messages (~13 tokens each -> ~260 tokens total), nowhere
    // near MAX_CONTEXT_TOKENS (500).
    const messages = Array.from({ length: 20 }, (_, i) => messageOfLength("user", 50, `m${i}`));

    expect(estimateTokens(messages)).toBeLessThan(MAX_CONTEXT_TOKENS);

    const trimmed = trimToTokenBudget(messages);

    expect(trimmed).toEqual(messages);
    expect(trimmed).toHaveLength(20);
  });

  it("trims a set of few very long messages down to under KEEP_CONTEXT_TOKENS, dropping oldest first", () => {
    // 8 long messages (300 chars -> 75 tokens each -> 600 tokens total),
    // over MAX_CONTEXT_TOKENS (500). Only the most recent 3 (225 tokens)
    // fit under KEEP_CONTEXT_TOKENS (250).
    const messages = Array.from({ length: 8 }, (_, i) => messageOfLength("user", 300, `m${i}`));

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
