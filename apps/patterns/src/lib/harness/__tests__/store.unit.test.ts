import { describe, expect, it } from "vitest";
import { createTable, UniqueViolationError } from "../store";

type MessageRow = { conversation: string; traceId: string | null; content: string };

describe("createTable", () => {
  it("inserts rows with increasing ids and selects by a column", () => {
    const table = createTable<MessageRow>();
    const first = table.insert({ conversation: "c1", traceId: "t1", content: "hi" });
    const second = table.insert({ conversation: "c2", traceId: "t2", content: "yo" });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(table.selectBy("conversation", "c2")).toEqual([second]);
    expect(table.rows()).toEqual([first, second]);
  });

  it("raises a 23505 on a duplicate unique key, naming the key and value", () => {
    const table = createTable<MessageRow>({ unique: ["traceId"] });
    table.insert({ conversation: "c1", traceId: "t1", content: "first" });

    const attempt = () => table.insert({ conversation: "c1", traceId: "t1", content: "again" });

    expect(attempt).toThrow(UniqueViolationError);
    try {
      attempt();
    } catch (error) {
      const violation = error as UniqueViolationError;
      expect(violation.code).toBe("23505");
      expect(violation.key).toBe("traceId");
      expect(violation.value).toBe("t1");
    }
    expect(table.rows()).toHaveLength(1);
  });

  it("lets a caller select the existing row after the conflict", () => {
    const table = createTable<MessageRow>({ unique: ["traceId"] });
    const existing = table.insert({ conversation: "c1", traceId: "t1", content: "first" });

    let row;
    try {
      row = table.insert({ conversation: "c1", traceId: "t1", content: "retry" });
    } catch (error) {
      if (!(error instanceof UniqueViolationError)) throw error;
      row = table.selectBy("traceId", "t1")[0];
    }

    expect(row).toEqual(existing);
  });

  it("never conflicts on a null or missing key, as Postgres does", () => {
    const table = createTable<MessageRow>({ unique: ["traceId"] });
    table.insert({ conversation: "c1", traceId: null, content: "a" });
    table.insert({ conversation: "c1", traceId: null, content: "b" });
    expect(table.rows()).toHaveLength(2);
  });

  it("clear empties the table and restarts the ids", () => {
    const table = createTable<MessageRow>();
    table.insert({ conversation: "c1", traceId: null, content: "a" });
    table.clear();
    expect(table.rows()).toEqual([]);
    expect(table.insert({ conversation: "c1", traceId: null, content: "b" }).id).toBe(1);
  });
});
