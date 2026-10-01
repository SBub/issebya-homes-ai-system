import { describe, expect, it } from "vitest";
import { createJoiningSummarizer, createMemory, groupByTurn, type Row } from "../fold";

function rows(turns: number): Row[] {
  const list: Row[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    list.push({ id: list.length + 1, role: "user", content: `question ${turn}` });
    list.push({ id: list.length + 1, role: "assistant", content: `reply ${turn}` });
  }
  return list;
}

const options = () => ({
  summarizer: createJoiningSummarizer(),
  windowTurns: 2,
  maxRecentFolds: 1,
});

describe("groupByTurn", () => {
  it("starts a group on a user row and joins assistant rows to it", () => {
    expect(groupByTurn(rows(2)).map((group) => group.map((row) => row.id))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("createMemory", () => {
  it("drops the turns outside the window and folds them once, with the watermark on the last folded row", async () => {
    const memory = createMemory(options());
    const all = rows(3);

    expect(memory.splitWindow(all).dropped.map((row) => row.id)).toEqual([1, 2]);
    const fold = await memory.fold(all);

    expect(fold).toEqual({
      id: 1,
      summary: "user: question 1 | assistant: reply 1",
      fromId: 1,
      toId: 2,
    });
    expect(memory.getSnapshot().watermark).toBe(2);
    expect(memory.unfolded(all).map((row) => row.id)).toEqual([3, 4, 5, 6]);
    // Folded rows are gone from the window as well: nothing reaches the model twice.
    expect(memory.splitWindow(memory.unfolded(all)).dropped).toEqual([]);
    expect(await memory.fold(all)).toBeNull();
  });

  it("distils the oldest fold into the preferences once more than one is kept", async () => {
    const memory = createMemory(options());
    await memory.fold(rows(3));
    const second = await memory.fold(rows(4));

    expect(second).toMatchObject({ id: 2, fromId: 3, toId: 4 });
    const snapshot = memory.getSnapshot();
    expect(snapshot.folds.map((fold) => fold.id)).toEqual([2]);
    expect(snapshot.preferences).toBe("question 1");
    expect(snapshot.watermark).toBe(4);
    expect(snapshot.log.at(-1)).toBe("fold 1 distilled into the preferences and deleted");
  });

  it("injects one assistant message: the preferences and the most recent fold", async () => {
    const memory = createMemory(options());
    expect(memory.buildMemoryMessage()).toBeNull();
    await memory.fold(rows(3));
    await memory.fold(rows(4));

    expect(memory.buildMemoryMessage()).toEqual({
      role: "assistant",
      content:
        "Preferences:\nquestion 1\n\nSummary of earlier conversation:\nuser: question 2 | assistant: reply 2",
    });
  });

  it("without the watermark the same rows fold again", async () => {
    const memory = createMemory({ ...options(), watermark: "none" });
    await memory.fold(rows(3));
    const second = await memory.fold(rows(4));
    expect(second).toMatchObject({ fromId: 1, toId: 4 });
    expect(memory.getSnapshot().watermark).toBeNull();
  });

  it("keeping every fold injects every fold", async () => {
    const memory = createMemory({ ...options(), folds: "keep-all" });
    await memory.fold(rows(3));
    await memory.fold(rows(4));
    await memory.fold(rows(5));
    expect(memory.getSnapshot().folds).toHaveLength(3);
    expect(memory.getSnapshot().preferences).toBeNull();
    expect(
      memory.buildMemoryMessage()?.content.split("Summary of earlier conversation:"),
    ).toHaveLength(4);
  });

  it("recordFold with nothing dropped is a no-op", async () => {
    const memory = createMemory(options());
    expect(await memory.recordFold([])).toBeNull();
    expect(memory.getSnapshot().log).toEqual(["fold: nothing new dropped out of the window"]);
  });
});
