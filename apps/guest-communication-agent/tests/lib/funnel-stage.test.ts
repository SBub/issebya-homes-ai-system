import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { deriveStageHint } from "@/lib/funnel-stage.js";

function toolMessage(name: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: name,
        output: { type: "text", value: "result" },
      },
    ],
  };
}

describe("deriveStageHint", () => {
  it("returns undefined when there are no tool messages at all", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
    ];
    expect(deriveStageHint(messages)).toBeUndefined();
  });

  it("returns 'link_sent' when sendBookingLink fired this turn", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "book it" },
      toolMessage("sendBookingLink"),
    ];
    expect(deriveStageHint(messages)).toBe("link_sent");
  });

  it("returns 'informed' when getPricing fired this turn", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "how much?" },
      toolMessage("getPricing"),
    ];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("returns 'informed' when checkAvailability fired this turn", () => {
    const messages: ModelMessage[] = [toolMessage("checkAvailability")];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("returns 'informed' when answerPropertyQuestion fired this turn", () => {
    const messages: ModelMessage[] = [toolMessage("answerPropertyQuestion")];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("prefers 'link_sent' over 'informed' when both fired in the same turn", () => {
    const messages: ModelMessage[] = [toolMessage("getPricing"), toolMessage("sendBookingLink")];
    expect(deriveStageHint(messages)).toBe("link_sent");
  });

  it("returns undefined when only escalateToOwner fired — escalation isn't part of this model", () => {
    const messages: ModelMessage[] = [toolMessage("escalateToOwner")];
    expect(deriveStageHint(messages)).toBeUndefined();
  });

  it("ignores user/assistant entries and only looks at tool messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "getPricing",
            input: { room: "room1" },
          },
        ],
      },
      toolMessage("getPricing"),
      { role: "assistant", content: "Here's the price..." },
    ];
    expect(deriveStageHint(messages)).toBe("informed");
  });
});
