import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildFirstTurnLine, hasAssistantMessage } from "@/agent/first-turn";

describe("buildFirstTurnLine", () => {
  it("returns the first-turn line when there is no assistant history", () => {
    expect(buildFirstTurnLine(false)).toBe(
      "This is the guest's first message in this conversation. Begin your reply with the AI disclosure described in your instructions.",
    );
  });

  it("returns null once the conversation has an assistant reply", () => {
    expect(buildFirstTurnLine(true)).toBeNull();
  });
});

describe("hasAssistantMessage", () => {
  it("is false for an empty list", () => {
    expect(hasAssistantMessage([])).toBe(false);
  });

  it("is false for user messages only", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hi" },
      { role: "user", content: "Anyone there?" },
    ];
    expect(hasAssistantMessage(messages)).toBe(false);
  });

  it("is true for a plain-text assistant message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    expect(hasAssistantMessage(messages)).toBe(true);
  });

  it("is true for an assistant message carrying only a tool call", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Room 1 price?" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "get_pricing",
            input: { room: "room1" },
          },
        ],
      },
    ];
    expect(hasAssistantMessage(messages)).toBe(true);
  });
});
