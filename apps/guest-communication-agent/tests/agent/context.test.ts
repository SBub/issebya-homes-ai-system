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
  it("leaves many short groups untouched when comfortably under budget", () => {
    // 20 short one-message groups (~13 tokens each -> 260 tokens total),
    // nowhere near MAX_CONTEXT_TOKENS.
    const groups = Array.from({ length: 20 }, (_, i) => [messageOfLength("user", 50, `m${i}`)]);

    expect(estimateTokens(groups.flat())).toBeLessThan(MAX_CONTEXT_TOKENS);

    const trimmed = trimToTokenBudget(groups);

    expect(trimmed).toEqual(groups);
  });

  it("trims to under KEEP_CONTEXT_TOKENS, dropping the oldest groups first", () => {
    // 40 long one-message groups (1100 chars -> 223 real tokens each ->
    // 8920 tokens total), just over MAX_CONTEXT_TOKENS (8000). The newest 26
    // (5798 tokens) fit under KEEP_CONTEXT_TOKENS (6000); 27 would not.
    const groups = Array.from({ length: 40 }, (_, i) => [messageOfLength("user", 1100, `m${i}`)]);

    expect(estimateTokens(groups.flat())).toBeGreaterThan(MAX_CONTEXT_TOKENS);

    const trimmed = trimToTokenBudget(groups);

    expect(estimateTokens(trimmed.flat())).toBeLessThanOrEqual(KEEP_CONTEXT_TOKENS);
    expect(trimmed).toHaveLength(26);
    expect(trimmed).toEqual(groups.slice(14));
  });

  it("drops whole turn groups only, never a message from inside one", () => {
    // 3-message groups (user, assistant, assistant) of 223 tokens per
    // message -> 669 per group, 13 groups -> 8697 tokens. KEEP (6000) falls
    // inside a group: 8 groups is 5352, 9 would be 6021.
    const groups = Array.from({ length: 13 }, (_, i) => [
      messageOfLength("user", 1100, `u${i}`),
      messageOfLength("assistant", 1100, `a${i}`),
      messageOfLength("assistant", 1100, `b${i}`),
    ]);

    const trimmed = trimToTokenBudget(groups);

    expect(trimmed).toHaveLength(8);
    expect(trimmed).toEqual(groups.slice(5));
    for (const group of trimmed) expect(group).toHaveLength(3);
  });

  it("never drops the last group, even if that group alone is over budget", () => {
    const groups = [
      [messageOfLength("user", 1100, "older")],
      [messageOfLength("user", 60000, "huge")],
    ];

    const trimmed = trimToTokenBudget(groups);

    expect(trimmed).toEqual([groups[1]]);
  });
});
