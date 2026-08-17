import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateTokens } from "@/agent/context.js";

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

// Builds a MessageRow-shaped object with `content` padded with repeated
// natural-English filler to (at least) `chars` characters, same
// word-shaped-filler trick as context.test.ts's messageOfLength (real BPE
// tokenizers compress a repeated single character far more than ordinary
// prose, so word filler keeps token counts representative), plus the
// id/created_at fields memory.ts needs for watermark correlation that
// context.test.ts's plain ModelMessage[] never carries.
function messageRow(
  id: string,
  role: "user" | "assistant",
  chars: number,
  createdAt: string,
): { id: string; role: "user" | "assistant"; content: string; created_at: string } {
  const phrase = "the quick brown fox jumps over the lazy dog and then trots back home again ";
  const body = `${id}: `;
  let content = body;
  while (content.length < chars) content += phrase;
  return { id, role, content: content.slice(0, chars), created_at: createdAt };
}

// 8 rows of 300 chars (63 real tokens) each, oldest-first — same shape as
// context.test.ts's over-budget fixture: 504 tokens total, just over
// MAX_CONTEXT_TOKENS (500), trims down to the newest 3 (189 tokens, under
// KEEP_CONTEXT_TOKENS), dropping the oldest 5.
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

// URLs (booking links, Google Maps links, etc.) are redacted by
// toModelMessage before DB rows become ModelMessage[] — see memory.ts's
// URL_PATTERN/URL_PLACEHOLDER comment for why. These tests exercise that
// redaction indirectly through loadMemory (historyMessages, the fast path)
// and foldMemory (the summarizer's transcript input), since toModelMessage
// itself isn't exported.
describe("URL redaction in toModelMessage", () => {
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

  const BOOKING_LINK_TEXT =
    "Here's your booking link for Room 1, September 18-20, 2026:\n\nhttps://issebya.com/booking?room=room1&checkIn=2026-09-18&checkOut=2026-09-20";
  const MAPS_LINK_TEXT = "Here's how to find us: https://maps.app.goo.gl/abc123XYZ, see you soon!";
  const PLAIN_TEXT =
    "Sure thing! Check-in is at 3pm, and there's a $50 deposit (refundable) — see you then :)";

  it("redacts a booking-link-shaped URL in historyMessages (loadMemory's fast path)", async () => {
    const rows = [
      messageRow("msg-1", "user", 10, "2026-08-01T00:00:00Z"),
      {
        ...messageRow("msg-2", "assistant", 10, "2026-08-01T00:01:00Z"),
        content: BOOKING_LINK_TEXT,
      },
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-url-1", phone: "+351900000010" });

    const assistantMessage = result.historyMessages.find((m) => m.role === "assistant");
    expect(assistantMessage?.content).toBe(
      "Here's your booking link for Room 1, September 18-20, 2026:\n\n[link]",
    );
    expect(assistantMessage?.content).not.toContain("https://");
  });

  it("redacts a Google Maps-style URL too, proving the regex isn't issebya.com-specific", async () => {
    const rows = [
      { ...messageRow("msg-1", "assistant", 10, "2026-08-01T00:00:00Z"), content: MAPS_LINK_TEXT },
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-url-2", phone: "+351900000011" });

    expect(result.historyMessages[0].content).toBe("Here's how to find us: [link], see you soon!");
    expect(result.historyMessages[0].content).not.toContain("https://");
  });

  it("leaves non-URL content — including punctuation and special characters — completely unchanged", async () => {
    const rows = [
      { ...messageRow("msg-1", "user", 10, "2026-08-01T00:00:00Z"), content: PLAIN_TEXT },
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-url-3", phone: "+351900000012" });

    expect(result.historyMessages[0].content).toBe(PLAIN_TEXT);
  });

  it("redacts URLs in the transcript passed to the summarizer (foldMemory's generateText call)", async () => {
    // 8 rows so the trim overflows and something actually gets dropped/folded
    // (same overflow shape as overflowingRows()), with msg-2 replaced by a
    // booking-link-bearing row.
    const rows = overflowingRows();
    rows[2] = { ...rows[2], content: `${rows[2].content} ${BOOKING_LINK_TEXT}` };
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);
    generateTextMock.mockResolvedValueOnce({ text: "Guest asked about booking Room 1." });

    await foldMemory({
      conversationId: "convo-url-4",
      phone: "+351900000013",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [call] = generateTextMock.mock.calls[0] as [{ messages: Array<{ content: string }> }];
    expect(call.messages[1].content).toContain("[link]");
    expect(call.messages[1].content).not.toContain("https://");
  });

  it("measurably shrinks token count on a URL-heavy message using the real tokenizer", async () => {
    // Two-URL message (booking link + Google Maps link), shaped like the
    // real message measured at 231 tokens under the real tokenizer against
    // a 250-token KEEP_CONTEXT_TOKENS budget.
    const twoLinkText =
      "Here's your booking link for Room 1, September 18-20, 2026:\n\n" +
      "https://issebya.com/booking?room=room1&checkIn=2026-09-18&checkOut=2026-09-20\n\n" +
      "And here's how to find the property: https://maps.app.goo.gl/8gk3nQeD2rHFujeK7";

    const rows = [
      { ...messageRow("msg-1", "assistant", 10, "2026-08-01T00:00:00Z"), content: twoLinkText },
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-url-5", phone: "+351900000014" });
    const redactedText = result.historyMessages[0].content as string;

    const beforeTokens = estimateTokens([{ role: "assistant", content: twoLinkText }]);
    const afterTokens = estimateTokens([{ role: "assistant", content: redactedText }]);

    expect(afterTokens).toBeLessThan(beforeTokens);
    expect(beforeTokens - afterTokens).toBeGreaterThan(20);
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
