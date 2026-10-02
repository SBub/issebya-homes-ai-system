import { describe, expect, it, vi } from "vitest";
import { createFakeModel, type Message } from "@/lib/harness/fake-model";
import { FALLBACK_TEXT, runTool, runTurn, toolResultMessage } from "../run-turn";

const history: Message[] = [
  { role: "user", content: "Are the 6th to the 8th free, and how much?" },
];

const dates = { from: "2026-10-06", to: "2026-10-08" };

describe("runTurn", () => {
  it("dispatches every call of a round and appends one batched tool message", async () => {
    const model = createFakeModel([
      {
        toolCalls: [
          { toolName: "check_dates", input: dates },
          { toolName: "lookup_rate", input: dates },
        ],
      },
      { text: "Free, at 120 EUR a night." },
    ]);

    const result = await runTurn(model, history, { maxRounds: 4 });

    expect(result.ended).toBe("text");
    expect(result.rounds).toBe(2);
    expect(result.reply).toBe("Free, at 120 EUR a night.");
    expect(result.turnMessages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_1", toolName: "check_dates", input: dates },
          { type: "tool-call", toolCallId: "call_2", toolName: "lookup_rate", input: dates },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "check_dates",
            output: { free: true, ...dates },
          },
          {
            type: "tool-result",
            toolCallId: "call_2",
            toolName: "lookup_rate",
            output: { nightly: 120, currency: "EUR" },
          },
        ],
      },
      { role: "assistant", content: "Free, at 120 EUR a night." },
    ]);
    expect(result.messages).toEqual([...history, ...result.turnMessages]);
    // The second call saw the first round's tool message.
    expect(model.calls[1]).toEqual(result.messages.slice(0, 3));
  });

  it("answers an unknown tool with an error object and lets the model go on", async () => {
    const model = createFakeModel([
      { toolCalls: [{ toolName: "book_dates", input: dates }] },
      { text: "I cannot book directly, but the dates are free." },
    ]);

    const result = await runTurn(model, history, { maxRounds: 4 });

    const toolMessage = result.turnMessages[1];
    expect(toolMessage.role).toBe("tool");
    expect(toolMessage.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "book_dates",
        output: {
          error: 'Unknown tool "book_dates". Valid tools: check_dates, lookup_rate.',
        },
      },
    ]);
    expect(result.ended).toBe("text");
  });

  it("stops at the round cap with the fallback reply, on a tool message", async () => {
    const forever = Array.from({ length: 10 }, () => ({
      toolCalls: [{ toolName: "check_dates", input: dates }],
    }));
    const model = createFakeModel(forever);

    const result = await runTurn(model, history, { maxRounds: 3 });

    expect(result.ended).toBe("round-cap");
    expect(result.rounds).toBe(3);
    expect(result.reply).toBe(FALLBACK_TEXT);
    expect(model.calls).toHaveLength(3);
    expect(result.messages.at(-1)?.role).toBe("tool");
  });

  it("replaces an empty reply with the fallback text", async () => {
    const model = createFakeModel([{ text: "   " }]);

    const result = await runTurn(model, history, { maxRounds: 3 });

    expect(result.ended).toBe("empty-reply");
    expect(result.reply).toBe(FALLBACK_TEXT);
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: FALLBACK_TEXT });
  });

  it("reports each round through onRound with the messages so far", async () => {
    const model = createFakeModel([
      { toolCalls: [{ toolName: "lookup_rate", input: dates }] },
      { text: "120 EUR." },
    ]);
    const onRound = vi.fn();

    await runTurn(model, history, { maxRounds: 4, onRound });

    expect(onRound).toHaveBeenCalledTimes(2);
    expect(onRound.mock.calls[0][0]).toHaveLength(3);
    expect(onRound.mock.calls[1][0]).toHaveLength(4);
  });
});

describe("runTool", () => {
  it("runs the known tools and answers an unknown name with an error object", async () => {
    await expect(runTool("lookup_rate", dates)).resolves.toEqual({ nightly: 120, currency: "EUR" });
    await expect(runTool("nope", {})).resolves.toEqual({
      error: 'Unknown tool "nope". Valid tools: check_dates, lookup_rate.',
    });
  });
});

describe("toolResultMessage", () => {
  it("pairs outputs with calls by position", () => {
    const message = toolResultMessage(
      [
        { toolCallId: "a", toolName: "x", input: {} },
        { toolCallId: "b", toolName: "y", input: {} },
      ],
      [1, 2],
    );
    expect(message).toEqual({
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "a", toolName: "x", output: 1 },
        { type: "tool-result", toolCallId: "b", toolName: "y", output: 2 },
      ],
    });
  });
});
