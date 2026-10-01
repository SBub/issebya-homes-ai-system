import { describe, expect, it } from "vitest";
import { createTable } from "@/lib/harness/store";
import { createJoiningSummarizer, createMemory } from "@/lib/memory-fold/fold";
import { foldMemory, loadMemory, type RowsTable, runTurn, type ScriptedTurn } from "../window";

const TURNS: ScriptedTurn[] = [
  {
    question: "Is the 6th to the 8th free?",
    tool: {
      name: "check_dates",
      input: { from: "2026-10-06", to: "2026-10-08" },
      output: { free: true, from: "2026-10-06", to: "2026-10-08" },
    },
    reply: "Yes, the 6th to the 8th is free.",
  },
  {
    question: "I prefer the quiet room at the back.",
    tool: {
      name: "search_notes",
      input: { query: "quiet room" },
      output: { hits: ["The back room faces the garden."] },
    },
    reply: "Noted, the back room faces the garden.",
  },
  {
    question: "How much per night?",
    tool: {
      name: "lookup_rate",
      input: { room: "small" },
      output: { nightly: 95, currency: "EUR" },
    },
    reply: "95 EUR a night.",
  },
  {
    question: "Can we check in late, around 23:00?",
    tool: {
      name: "search_notes",
      input: { query: "late check-in" },
      output: { hits: ["Late check-in is fine with notice."] },
    },
    reply: "Late check-in is fine with notice.",
  },
  {
    question: "My name is Ana, two adults.",
    tool: {
      name: "search_notes",
      input: { query: "occupancy" },
      output: { hits: ["Up to two adults."] },
    },
    reply: "Thanks Ana, two adults noted.",
  },
  {
    question: "Is there parking?",
    tool: {
      name: "search_notes",
      input: { query: "parking" },
      output: { hits: ["Free street parking."] },
    },
    reply: "There is free street parking.",
  },
  {
    question: "We arrive by train.",
    tool: {
      name: "search_notes",
      input: { query: "station" },
      output: { hits: ["Ten minutes on foot from the station."] },
    },
    reply: "The station is ten minutes on foot.",
  },
];

const OPTIONS = { verbatimTurns: 2, budget: { max: 160, keep: 120 } };

function setup() {
  const table: RowsTable = createTable();
  const memory = createMemory({
    summarizer: createJoiningSummarizer(),
    windowTurns: 0,
    maxRecentFolds: 1,
  });
  const send = (index: number) => runTurn(table, memory, TURNS[index], OPTIONS);
  return { table, memory, send };
}

describe("the memory window over turns", () => {
  it("replays the last two turns verbatim and older ones as text, with no memory message yet", async () => {
    const { send } = setup();
    await send(0);
    await send(1);
    const { saw } = await send(2);

    expect(saw.memoryMessage).toBeNull();
    expect(saw.groups.map((group) => group.length)).toEqual([2, 4, 1]);
    expect(saw.messages[0]).toEqual({ role: "user", content: "Is the 6th to the 8th free?" });
    expect(saw.messages[1]).toEqual({
      role: "assistant",
      content: "Yes, the 6th to the 8th is free.",
    });
    expect(saw.messages[4].role).toBe("tool");
    expect(saw.droppedRows).toEqual([]);
  });

  it("folds after the send what the trim drops once this turn's reply counts, and moves the watermark", async () => {
    const { send, memory } = setup();
    const folds = [];
    for (let index = 0; index < 4; index++) folds.push((await send(index)).fold);

    expect(folds.slice(0, 3)).toEqual([null, null, null]);
    expect(folds[3]).toMatchObject({ id: 1, fromId: 1, toId: 6 });
    expect(folds[3]?.summary).toContain(
      "user: Is the 6th to the 8th free? | assistant: Yes, the 6th to the 8th is free.",
    );
    expect(memory.getSnapshot().watermark).toBe(6);
  });

  it("the next turn gets the fold as one assistant message ahead of the unfolded history", async () => {
    const { send } = setup();
    for (let index = 0; index < 4; index++) await send(index);
    const { saw } = await send(4);

    expect(saw.memoryMessage?.role).toBe("assistant");
    expect(saw.memoryMessage?.content).toContain(
      "Summary of earlier conversation:\nuser: Is the 6th to the 8th free?",
    );
    expect(saw.messages[0]).toBe(saw.memoryMessage);
    // Rows 1 to 6 are folded: the history starts at row 7.
    expect(saw.messages[1]).toEqual({
      role: "user",
      content: "Can we check in late, around 23:00?",
    });
    expect(saw.groups).toHaveLength(2);
  });

  it("on turn seven the model sees the memory, two text turns and a verbatim one; the send then folds and distils", async () => {
    const { send, memory } = setup();
    for (let index = 0; index < 6; index++) await send(index);
    const { saw, fold } = await send(6);

    expect(saw.messages[0]).toBe(saw.memoryMessage);
    expect(saw.groups.map((group) => group.length)).toEqual([2, 2, 4, 1]);
    expect(fold).toMatchObject({ id: 2, fromId: 7, toId: 12 });
    const snapshot = memory.getSnapshot();
    expect(snapshot.folds.map((entry) => [entry.fromId, entry.toId])).toEqual([[7, 12]]);
    expect(snapshot.preferences).toBe(
      "Is the 6th to the 8th free?; I prefer the quiet room at the back.; How much per night?",
    );
    expect(snapshot.watermark).toBe(12);
    expect(memory.buildMemoryMessage()?.content.startsWith("Preferences:\nIs the 6th")).toBe(true);
  });

  it("loadMemory applies the watermark before the tiers and the trim", async () => {
    const { send, table, memory } = setup();
    for (let index = 0; index < 4; index++) await send(index);
    const loaded = loadMemory(table.rows(), memory, OPTIONS);
    expect(loaded.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(loaded.tokens.before).toBe(loaded.tokens.after);
    // Nothing new has dropped since the send: a second fold is a no-op.
    expect(await foldMemory(table.rows(), memory, OPTIONS)).toBeNull();
  });
});
