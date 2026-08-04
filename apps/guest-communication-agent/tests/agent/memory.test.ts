import { beforeEach, describe, expect, it, vi } from "vitest";

// memory.ts's own orchestration (trim -> id correlation -> watermark filter
// -> summarize-and-upsert) is under test here, so db.ts's queries are mocked
// directly rather than mocking createAdminClient/lookupGuestContact underneath them.
const loadRecentMessagesMock = vi.fn();
const loadGuestInfoMock = vi.fn();
const getGuestMemoryMock = vi.fn();
const upsertGuestMemoryMock = vi.fn();
vi.mock("@/lib/db.js", () => ({
  loadRecentMessages: loadRecentMessagesMock,
  loadGuestInfo: loadGuestInfoMock,
  getGuestMemory: getGuestMemoryMock,
  upsertGuestMemory: upsertGuestMemoryMock,
}));

// summarizeConversation's only external call — mocked the same way
// run-turn.test.ts mocks generateText, at the "ai" module boundary.
const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

// Only needs a working `.chat(modelId)` since generateText itself is mocked.
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: (modelId: string) => modelId }),
}));

const { loadMemory, buildContextBlock } = await import("@/agent/memory.js");

// Builds a MessageRow-shaped object with `content` padded to exactly
// `chars` characters, same measured-length trick as context.test.ts's
// messageOfLength, plus the id/created_at fields memory.ts needs for
// watermark correlation that context.test.ts's plain ModelMessage[] never
// carries.
function messageRow(
  id: string,
  role: "user" | "assistant",
  chars: number,
  createdAt: string,
): { id: string; role: "user" | "assistant"; content: string; created_at: string } {
  const body = `${id}:`;
  const content = body + "x".repeat(Math.max(0, chars - body.length));
  return { id, role, content, created_at: createdAt };
}

// 8 rows of 2000 chars (~500 tokens) each, oldest-first — same shape as
// context.test.ts's over-budget fixture: ~4000 tokens total, over
// MAX_CONTEXT_TOKENS (3000), trims down to the newest 3 (~1500 tokens,
// under KEEP_CONTEXT_TOKENS), dropping the oldest 5.
function overflowingRows() {
  return Array.from({ length: 8 }, (_, i) =>
    messageRow(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", 2000, `2026-08-0${i + 1}T00:00:00Z`),
  );
}

describe("loadMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through untrimmed history and the fallback contextBlock when nothing overflows and there's no prior summary", async () => {
    const rows = [
      messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z"),
      messageRow("msg-2", "assistant", 50, "2026-08-01T00:01:00Z"),
      messageRow("msg-3", "user", 50, "2026-08-01T00:02:00Z"),
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    loadGuestInfoMock.mockResolvedValue(null);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-1", phone: "+351900000001" });

    expect(result.historyMessages).toHaveLength(3);
    expect(result.contextBlock).toBe("No prior guest information available.");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
  });

  it("summarizes and upserts when overflow drops rows newer than the existing watermark (or with no watermark at all)", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    loadGuestInfoMock.mockResolvedValue(null);
    getGuestMemoryMock.mockResolvedValue(null); // no prior guest_memory row at all
    generateTextMock.mockResolvedValueOnce({
      text: "Guest asked about rooms 1-3, no booking yet.",
    });

    const result = await loadMemory({
      conversationId: "convo-2",
      // Already-normalized (bare) form — the webhook route normalizes
      // once, at the ingress boundary, before loadMemory ever sees `phone`.
      phone: "+351900000002",
    });

    // Trimmed to the newest 3 rows (msg-5, msg-6, msg-7); the oldest 5
    // (msg-0..msg-4) were dropped and, with no watermark at all, are all
    // "new" and get folded into the summary.
    expect(result.historyMessages).toHaveLength(3);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [call] = generateTextMock.mock.calls[0] as [{ messages: Array<{ content: string }> }];
    expect(call.messages[1].content).toContain("msg-0");
    expect(call.messages[1].content).toContain("msg-4");
    expect(call.messages[1].content).not.toContain("msg-5:");

    // Upserted under exactly the phone value loadMemory was given — it does
    // no normalization of its own anymore, with the watermark set to the
    // newest of the newly-folded-in dropped rows (msg-4 — the last of
    // msg-0..msg-4).
    expect(upsertGuestMemoryMock).toHaveBeenCalledWith(
      "+351900000002",
      "Guest asked about rooms 1-3, no booking yet.",
      "msg-4",
    );
    expect(result.contextBlock).toBe(
      "Summary of earlier conversation:\nGuest asked about rooms 1-3, no booking yet.",
    );
  });

  it("skips the model call and the write when every dropped row is already covered by the existing watermark", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    loadGuestInfoMock.mockResolvedValue(null);
    // Watermark already covers msg-0..msg-4 (all 5 rows this turn drops) —
    // the mechanism should be fully self-throttling here.
    getGuestMemoryMock.mockResolvedValue({
      summary: "Earlier: guest asked about rooms 1-3.",
      summarizedThroughMessageId: "msg-4",
    });

    const result = await loadMemory({ conversationId: "convo-3", phone: "+351900000003" });

    expect(result.historyMessages).toHaveLength(3);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
    expect(result.contextBlock).toBe(
      "Summary of earlier conversation:\nEarlier: guest asked about rooms 1-3.",
    );
  });
});

describe("buildContextBlock", () => {
  it("combines guest facts and summary as two labeled sections when both are present", () => {
    expect(buildContextBlock("This guest has stayed with us before.", "Asked about room 2.")).toBe(
      "Guest facts:\nThis guest has stayed with us before.\n\nSummary of earlier conversation:\nAsked about room 2.",
    );
  });

  it("returns just the guest-facts section when there's no summary", () => {
    expect(buildContextBlock("This guest has stayed with us before.", null)).toBe(
      "Guest facts:\nThis guest has stayed with us before.",
    );
  });

  it("returns just the summary section when there are no guest facts", () => {
    expect(buildContextBlock(null, "Asked about room 2.")).toBe(
      "Summary of earlier conversation:\nAsked about room 2.",
    );
  });

  it("falls back to the existing 'no prior guest information' text when neither is present", () => {
    expect(buildContextBlock(null, null)).toBe("No prior guest information available.");
  });
});
