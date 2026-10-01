import { describe, expect, it } from "vitest";
import { INVALID_TRACE_ID } from "@/lib/harness/span-exporter";
import { UniqueViolationError } from "@/lib/harness/store";
import { createMessagesTable, recordReply } from "../record-reply";

const TRACE_A = "a".repeat(32);
const TRACE_B = "b".repeat(32);

describe("recordReply", () => {
  it("inserts once and returns the existing row on a retry with the same trace id", () => {
    const table = createMessagesTable();
    const first = recordReply(table, { conversationId: "c1", content: "Hi", traceId: TRACE_A });
    const retry = recordReply(table, { conversationId: "c1", content: "Hi", traceId: TRACE_A });

    expect(first).toEqual({ id: 1, outcome: "inserted", warning: null });
    expect(retry).toEqual({ id: 1, outcome: "existing", warning: null });
    expect(table.rows()).toHaveLength(1);
  });

  it("a different trace id is a different row", () => {
    const table = createMessagesTable();
    recordReply(table, { conversationId: "c1", content: "Hi", traceId: TRACE_A });
    const other = recordReply(table, { conversationId: "c2", content: "Hello", traceId: TRACE_B });

    expect(other).toEqual({ id: 2, outcome: "inserted", warning: null });
    expect(table.rows()).toHaveLength(2);
  });

  it("without conflict handling the retry throws the unique violation", () => {
    const table = createMessagesTable();
    recordReply(table, { conversationId: "c1", content: "Hi", traceId: TRACE_A });

    expect(() =>
      recordReply(
        table,
        { conversationId: "c1", content: "Hi", traceId: TRACE_A },
        { conflict: "throw" },
      ),
    ).toThrow(UniqueViolationError);
  });

  it("rejects the all-zero trace id as a key: stored null, reported, never a collision", () => {
    const table = createMessagesTable();
    const first = recordReply(table, {
      conversationId: "c1",
      content: "Hi",
      traceId: INVALID_TRACE_ID,
    });
    const other = recordReply(table, {
      conversationId: "c2",
      content: "Hello",
      traceId: INVALID_TRACE_ID,
    });

    expect(first.outcome).toBe("inserted");
    expect(first.warning).toContain("invalid trace id");
    expect(other).toMatchObject({ id: 2, outcome: "inserted" });
    expect(table.rows().map((row) => row.traceId)).toEqual([null, null]);
  });

  it("accepting the all-zero id makes a different conversation's reply come back as the first row", () => {
    const table = createMessagesTable();
    recordReply(
      table,
      { conversationId: "c1", content: "Hi", traceId: INVALID_TRACE_ID },
      { guard: "accept-zero" },
    );
    const other = recordReply(
      table,
      { conversationId: "c2", content: "Hello", traceId: INVALID_TRACE_ID },
      { guard: "accept-zero" },
    );

    expect(other).toEqual({ id: 1, outcome: "existing", warning: null });
    expect(table.rows()).toHaveLength(1);
    expect(table.rows()[0].conversationId).toBe("c1");
  });
});
