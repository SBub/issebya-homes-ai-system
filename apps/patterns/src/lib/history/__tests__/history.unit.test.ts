import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/harness/fake-model";
import {
  buildHistory,
  estimateTokens,
  finalizeTurn,
  groupByTurn,
  type MessageRow,
  trimToBudget,
} from "../history";

const toolCall: Message = {
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: "c1", toolName: "check_dates", input: { from: "a" } }],
};
const toolResult: Message = {
  role: "tool",
  content: [
    { type: "tool-result", toolCallId: "c1", toolName: "check_dates", output: { free: true } },
  ],
};

function turn(id: number, reply: string, stored: boolean): MessageRow[] {
  return [
    { id, role: "user", content: `question ${id}`, turnMessages: null },
    {
      id: id + 1,
      role: "assistant",
      content: reply,
      turnMessages: stored ? [toolCall, toolResult, { role: "assistant", content: reply }] : null,
    },
  ];
}

describe("finalizeTurn", () => {
  it("keeps tool calls, tool results and text, and drops everything else", () => {
    const messages = finalizeTurn(
      [
        { role: "user", content: "stray" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "thinking aloud" },
            { type: "tool-call", toolCallId: "c1", toolName: "x", input: {} },
          ],
        },
        toolResult,
        { role: "assistant", content: "Done." },
      ],
      "Done.",
    );
    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
  });

  it("appends the reply when the tail ends on a tool message", () => {
    const messages = finalizeTurn([toolCall, toolResult], "Fallback reply.");
    expect(messages.at(-1)).toEqual({ role: "assistant", content: "Fallback reply." });
    expect(messages).toHaveLength(3);
  });

  it("does not append a second reply when the tail already ends in text", () => {
    const messages = finalizeTurn(
      [toolCall, toolResult, { role: "assistant", content: "Ok." }],
      "Ok.",
    );
    expect(messages).toHaveLength(3);
  });
});

describe("groupByTurn", () => {
  it("starts a group on every user row and joins the assistant rows after it", () => {
    const rows = [...turn(1, "a", true), ...turn(3, "b", true)];
    const groups = groupByTurn(rows);
    expect(groups.map((group) => group.map((row) => row.id))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("puts leading assistant rows in their own group", () => {
    const rows: MessageRow[] = [
      { id: 1, role: "assistant", content: "hello", turnMessages: null },
      ...turn(2, "a", true),
    ];
    expect(groupByTurn(rows).map((group) => group.length)).toEqual([1, 2]);
  });
});

describe("buildHistory", () => {
  const rows = [...turn(1, "one", true), ...turn(3, "two", true), ...turn(5, "three", true)];

  it("replays the last N turns verbatim and the older ones as text", () => {
    const groups = buildHistory(rows, { verbatimTurns: 2 });

    expect(groups[0]).toEqual([
      { role: "user", content: "question 1" },
      { role: "assistant", content: "one" },
    ]);
    expect(groups[1]).toEqual([
      { role: "user", content: "question 3" },
      toolCall,
      toolResult,
      { role: "assistant", content: "two" },
    ]);
    expect(groups[2]).toHaveLength(4);
  });

  it("replays a row without stored messages as text even inside the verbatim window", () => {
    const groups = buildHistory([...turn(1, "one", true), ...turn(3, "two", false)], {
      verbatimTurns: 3,
    });
    expect(groups[1]).toEqual([
      { role: "user", content: "question 3" },
      { role: "assistant", content: "two" },
    ]);
  });

  it("with zero verbatim turns everything is text", () => {
    const groups = buildHistory(rows, { verbatimTurns: 0 });
    expect(groups.flat().every((message) => typeof message.content === "string")).toBe(true);
  });
});

describe("trimToBudget", () => {
  const groups = buildHistory(
    [...turn(1, "one", true), ...turn(3, "two", true), ...turn(5, "three", true)],
    { verbatimTurns: 3 },
  );
  const total = estimateTokens(groups.flat());

  it("leaves everything alone under the max", () => {
    expect(trimToBudget(groups, { max: total, keep: total })).toEqual({ kept: groups, dropped: 0 });
  });

  it("drops whole groups from the oldest until the rest fits in keep", () => {
    const one = estimateTokens(groups[0]);
    const { kept, dropped } = trimToBudget(groups, { max: total - 1, keep: total - one });
    expect(dropped).toBe(1);
    expect(kept).toEqual(groups.slice(1));
  });

  it("never drops the last group", () => {
    const { kept, dropped } = trimToBudget(groups, { max: 1, keep: 1 });
    expect(dropped).toBe(2);
    expect(kept).toEqual([groups[2]]);
  });
});

describe("estimateTokens", () => {
  it("counts about four characters per token over text and tool parts", () => {
    expect(estimateTokens([{ role: "user", content: "12345678" }])).toBe(2);
    expect(estimateTokens([toolResult])).toBe(
      Math.ceil(JSON.stringify(toolResult.content).length / 4),
    );
  });
});
