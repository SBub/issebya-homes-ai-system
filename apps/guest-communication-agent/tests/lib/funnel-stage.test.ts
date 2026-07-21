import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { deriveStageHint } from "@/lib/funnel-stage.js";

function toolMessage(name: string): ToolMessage {
  return new ToolMessage("result", "call_1", name);
}

describe("deriveStageHint", () => {
  it("returns undefined when there are no ToolMessage entries at all", () => {
    const messages = [new HumanMessage("hi"), new AIMessage("hello!")];
    expect(deriveStageHint(messages)).toBeUndefined();
  });

  it("returns 'link_sent' when sendBookingLink fired this turn", () => {
    const messages = [new HumanMessage("book it"), toolMessage("sendBookingLink")];
    expect(deriveStageHint(messages)).toBe("link_sent");
  });

  it("returns 'informed' when getPricing fired this turn", () => {
    const messages = [new HumanMessage("how much?"), toolMessage("getPricing")];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("returns 'informed' when checkAvailability fired this turn", () => {
    const messages = [toolMessage("checkAvailability")];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("returns 'informed' when answerPropertyQuestion fired this turn", () => {
    const messages = [toolMessage("answerPropertyQuestion")];
    expect(deriveStageHint(messages)).toBe("informed");
  });

  it("prefers 'link_sent' over 'informed' when both fired in the same turn", () => {
    const messages = [toolMessage("getPricing"), toolMessage("sendBookingLink")];
    expect(deriveStageHint(messages)).toBe("link_sent");
  });

  it("returns undefined when only escalateToOwner fired — escalation isn't part of this model", () => {
    const messages = [toolMessage("escalateToOwner")];
    expect(deriveStageHint(messages)).toBeUndefined();
  });

  it("ignores AIMessage/HumanMessage entries and only looks at ToolMessage", () => {
    const messages = [
      new HumanMessage("hi"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "getPricing", args: { room: "room1" }, id: "call_1" }],
      }),
      toolMessage("getPricing"),
      new AIMessage("Here's the price..."),
    ];
    expect(deriveStageHint(messages)).toBe("informed");
  });
});
