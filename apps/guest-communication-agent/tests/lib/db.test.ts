import { describe, expect, it, vi } from "vitest";

// loadRecentMessages' chain: .select(...).eq(...).order(...).limit(...).
const limitMock = vi.fn();
const orderMock = vi.fn(() => ({ limit: limitMock }));
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { loadRecentMessages } = await import("@/lib/db.js");

describe("loadRecentMessages", () => {
  it("returns stored turn_messages and treats an unknown schema_version as null (text-only replay)", async () => {
    const stored = {
      schema_version: 1,
      messages: [{ role: "assistant", content: "Room 1 is free." }],
    };
    // Newest first, as the query orders them.
    limitMock.mockResolvedValueOnce({
      data: [
        {
          id: "msg-3",
          role: "assistant",
          content: "Hi",
          created_at: "2026-09-22T00:02:00Z",
          turn_messages: { schema_version: 2, messages: [] },
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Room 1 is free.",
          created_at: "2026-09-22T00:01:00Z",
          turn_messages: stored,
        },
        {
          id: "msg-1",
          role: "user",
          content: "Is room 1 free?",
          created_at: "2026-09-22T00:00:00Z",
          turn_messages: null,
        },
      ],
      error: null,
    });

    const rows = await loadRecentMessages("convo-1");

    expect(selectMock).toHaveBeenCalledWith("id, role, content, created_at, turn_messages");
    expect(rows.map((r) => [r.id, r.turn_messages])).toEqual([
      ["msg-1", null],
      ["msg-2", stored],
      ["msg-3", null],
    ]);
  });
});
