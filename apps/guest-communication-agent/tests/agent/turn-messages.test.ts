import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { finalizeTurnMessages, truncateToolOutputs } from "@/agent/turn-messages.js";

function toolCall(input: unknown): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-1", toolName: "run_code", input }],
  };
}

function toolResult(value: unknown): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "run_code",
        output: { type: "json", value: value as never },
      },
    ],
  };
}

describe("truncateToolOutputs", () => {
  it("cuts an oversized tool-result to text with the truncation marker, leaving the tool-call input untouched", () => {
    const bigInput = { code: "x".repeat(5000) };
    const bigValue = { rows: "y".repeat(3000) };
    const serialized = JSON.stringify(bigValue);
    const messages = [toolCall(bigInput), toolResult(bigValue)];

    const [call, result] = truncateToolOutputs(messages);

    expect(call).toEqual(toolCall(bigInput));
    expect(result).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "run_code",
          output: {
            type: "text",
            value: `${serialized.slice(0, 2000)}…[truncated ${serialized.length - 2000} of ${serialized.length} chars; call the tool again for the full output]`,
          },
        },
      ],
    });
  });

  it("leaves a tool-result at or under 2,000 chars as json", () => {
    const value = "z".repeat(1998); // JSON.stringify adds the two quotes -> 2000
    const messages = [toolResult(value)];

    expect(truncateToolOutputs(messages)).toEqual(messages);
  });
});

describe("finalizeTurnMessages", () => {
  it("appends the reply text when the tail ends on a tool message (step cap)", () => {
    const tail = [toolCall({ code: "a" }), toolResult({ ok: true })];

    const stored = finalizeTurnMessages(tail, "Sorry, please try again.");

    expect(stored.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Sorry, please try again.",
    });
    expect(stored.messages).toHaveLength(3);
  });

  it("does not duplicate a tail that already ends in assistant text", () => {
    const tail: ModelMessage[] = [
      toolCall({ code: "a" }),
      toolResult({ ok: true }),
      { role: "assistant", content: "Room 1 is free." },
    ];

    const stored = finalizeTurnMessages(tail, "Room 1 is free.");

    expect(stored.messages).toEqual(tail);
  });

  it("drops reasoning parts and keeps text and tool-call parts", () => {
    const tail: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolCallId: "call-1", toolName: "run_code", input: { code: "a" } },
        ],
      },
      toolResult({ ok: true }),
      { role: "assistant", content: "Done." },
    ];

    const stored = finalizeTurnMessages(tail, "Done.");

    expect(stored.messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool-call", toolCallId: "call-1", toolName: "run_code", input: { code: "a" } },
      ],
    });
  });

  it("carries schema_version 1", () => {
    expect(finalizeTurnMessages([], "Hi").schema_version).toBe(1);
  });
});
