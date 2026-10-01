import { describe, expect, it } from "vitest";
import { createFakeModel, type Message } from "../fake-model";

const ask: Message[] = [{ role: "user", content: "Are the dates free?" }];

describe("createFakeModel", () => {
  it("answers each call with the next round, tool calls first", async () => {
    const model = createFakeModel([
      { toolCalls: [{ toolName: "check_dates", input: { from: "2026-10-06", to: "2026-10-08" } }] },
      { text: "Yes, they are free." },
    ]);

    const first = await model.generate(ask);
    expect(first.text).toBe("");
    expect(first.toolCalls).toEqual([
      {
        toolCallId: "call_1",
        toolName: "check_dates",
        input: { from: "2026-10-06", to: "2026-10-08" },
      },
    ]);
    expect(first.response.messages).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "check_dates",
            input: { from: "2026-10-06", to: "2026-10-08" },
          },
        ],
      },
    ]);

    const second = await model.generate(ask);
    expect(second.text).toBe("Yes, they are free.");
    expect(second.toolCalls).toEqual([]);
    expect(second.response.messages).toEqual([
      { role: "assistant", content: "Yes, they are free." },
    ]);
  });

  it("gives every tool call in a round its own id", async () => {
    const model = createFakeModel([
      {
        toolCalls: [
          { toolName: "check_dates", input: {} },
          { toolName: "lookup_rate", input: {} },
        ],
      },
    ]);
    const { toolCalls } = await model.generate(ask);
    expect(toolCalls.map((call) => call.toolCallId)).toEqual(["call_1", "call_2"]);
  });

  it("returns an empty reply once the fixture is used up", async () => {
    const model = createFakeModel([{ text: "Done." }]);
    await model.generate(ask);
    const empty = await model.generate(ask);
    expect(empty).toEqual({ text: "", toolCalls: [], response: { messages: [] } });
  });

  it("records the messages of every call", async () => {
    const model = createFakeModel([{ text: "One." }, { text: "Two." }]);
    await model.generate(ask);
    const longer: Message[] = [...ask, { role: "assistant", content: "One." }];
    await model.generate(longer);
    expect(model.calls).toEqual([ask, longer]);
  });
});
