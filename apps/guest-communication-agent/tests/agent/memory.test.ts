import { beforeEach, describe, expect, it, vi } from "vitest";

// memory.ts's own orchestration (trim -> id correlation -> watermark filter
// -> summarize-and-upsert) is under test here, so db.ts's queries are mocked
// directly rather than mocking createAdminClient underneath them.
const loadRecentMessagesMock = vi.fn();
const getGuestMemoryMock = vi.fn();
const upsertGuestMemoryMock = vi.fn();
vi.mock("@/lib/db.js", () => ({
  loadRecentMessages: loadRecentMessagesMock,
  getGuestMemory: getGuestMemoryMock,
  upsertGuestMemory: upsertGuestMemoryMock,
}));

// summarizeConversation's two external calls — generateText mocked the same
// way run-turn.test.ts mocks it, at the "ai" module boundary; loadPrompt
// (Braintrust) mocked to return a stub Prompt whose build() renders
// {{prior_summary}}/{{transcript}} the same way the real Braintrust prompt
// does, so assertions on the resulting user-message content still hold.
const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: generateTextMock };
});

const loadPromptMock = vi.fn();
vi.mock("braintrust", () => ({
  loadPrompt: loadPromptMock,
}));

// Only needs a working `.chat(modelId)` since generateText itself is mocked.
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: (modelId: string) => modelId }),
}));

const { loadMemory, foldMemory, buildContextBlock } = await import("@/agent/memory.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

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

// 8 rows of 300 chars (~75 tokens) each, oldest-first — same shape as
// context.test.ts's over-budget fixture: ~600 tokens total, over
// MAX_CONTEXT_TOKENS (500), trims down to the newest 3 (~225 tokens,
// under KEEP_CONTEXT_TOKENS), dropping the oldest 5.
function overflowingRows() {
  return Array.from({ length: 8 }, (_, i) =>
    messageRow(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", 300, `2026-08-0${i + 1}T00:00:00Z`),
  );
}

describe("loadMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPromptMock.mockResolvedValue({
      build: ({ prior_summary, transcript }: { prior_summary: string; transcript: string }) => ({
        messages: [
          { role: "system", content: "You compress an older stretch..." },
          {
            role: "user",
            content: `Prior summary:\n${prior_summary}\n\nFold in this older part of the conversation:\n${transcript}\n\nReturn the updated summary.`,
          },
        ],
      }),
    });
  });

  it("passes through untrimmed history and the fallback contextBlock when nothing overflows and there's no prior summary", async () => {
    const rows = [
      messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z"),
      messageRow("msg-2", "assistant", 50, "2026-08-01T00:01:00Z"),
      messageRow("msg-3", "user", 50, "2026-08-01T00:02:00Z"),
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-1", phone: "+351900000001" });

    expect(result.historyMessages).toHaveLength(3);
    expect(result.contextBlock).toBe("No prior guest information available.");
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
  });

  // The fast path never summarizes or writes, even when this turn's trim
  // drops rows past the existing watermark — that's foldMemory's job now
  // (see the "foldMemory" describe block below), called later by
  // run-turn.ts, off this turn's own critical path.
  it("returns the trimmed history without summarizing or writing, even when overflow drops rows past the watermark", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null); // no prior guest_memory row at all

    const result = await loadMemory({
      conversationId: "convo-2",
      // Already-normalized (bare) form — the webhook route normalizes
      // once, at the ingress boundary, before loadMemory ever sees `phone`.
      phone: "+351900000002",
    });

    // Trimmed to the newest 3 rows (msg-5, msg-6, msg-7) exactly as before —
    // the trim logic itself is unchanged by the loadMemory/foldMemory split.
    expect(result.historyMessages).toHaveLength(3);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
    expect(result.contextBlock).toBe("No prior guest information available.");
  });

  it("reads whatever summary guest_memory already has as-is, without recomputing it — up to one turn stale by design", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
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

describe("foldMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPromptMock.mockResolvedValue({
      build: ({ prior_summary, transcript }: { prior_summary: string; transcript: string }) => ({
        messages: [
          { role: "system", content: "You compress an older stretch..." },
          {
            role: "user",
            content: `Prior summary:\n${prior_summary}\n\nFold in this older part of the conversation:\n${transcript}\n\nReturn the updated summary.`,
          },
        ],
      }),
    });
  });

  it("summarizes and upserts when overflow drops rows newer than the existing watermark (or with no watermark at all)", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null); // no prior guest_memory row at all
    generateTextMock.mockResolvedValueOnce({
      text: "Guest asked about rooms 1-3, no booking yet.",
    });

    await foldMemory({
      conversationId: "convo-2",
      // Already-normalized (bare) form — the webhook route normalizes
      // once, at the ingress boundary, before foldMemory ever sees `phone`.
      phone: "+351900000002",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    // The oldest 5 rows (msg-0..msg-4) were dropped by the trim and, with no
    // watermark at all, are all "new" and get folded into the summary.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [call] = generateTextMock.mock.calls[0] as [{ messages: Array<{ content: string }> }];
    expect(call.messages[1].content).toContain("msg-0");
    expect(call.messages[1].content).toContain("msg-4");
    expect(call.messages[1].content).not.toContain("msg-5:");

    // Upserted under exactly the phone value foldMemory was given — it does
    // no normalization of its own, with the watermark set to the newest of
    // the newly-folded-in dropped rows (msg-4 — the last of msg-0..msg-4).
    expect(upsertGuestMemoryMock).toHaveBeenCalledWith(
      "+351900000002",
      "Guest asked about rooms 1-3, no booking yet.",
      "msg-4",
    );
  });

  it("skips the model call and the write when every dropped row is already covered by the existing watermark", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    // Watermark already covers msg-0..msg-4 (all 5 rows this turn drops) —
    // the mechanism should be fully self-throttling here.
    getGuestMemoryMock.mockResolvedValue({
      summary: "Earlier: guest asked about rooms 1-3.",
      summarizedThroughMessageId: "msg-4",
    });

    await foldMemory({
      conversationId: "convo-3",
      phone: "+351900000003",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
  });

  it("is a cheap no-op — no model call, no write — when nothing overflows at all", async () => {
    const rows = [
      messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z"),
      messageRow("msg-2", "assistant", 50, "2026-08-01T00:01:00Z"),
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    await foldMemory({
      conversationId: "convo-1",
      phone: "+351900000001",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(upsertGuestMemoryMock).not.toHaveBeenCalled();
  });
});

describe("buildContextBlock", () => {
  it("returns the labeled summary section when a summary is present", () => {
    expect(buildContextBlock("Asked about room 2.")).toBe(
      "Summary of earlier conversation:\nAsked about room 2.",
    );
  });

  it("falls back to the existing 'no prior guest information' text when there's no summary", () => {
    expect(buildContextBlock(null)).toBe("No prior guest information available.");
  });
});
