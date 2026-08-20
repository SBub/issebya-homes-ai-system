import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateTokens } from "@/agent/context.js";

// Same in-memory OTel wiring as run-turn.test.ts/approval-gate.test.ts: real
// tracing.ts's withTurnSpan stays real here (only loadPrompt/generateText are
// mocked below), but with no OTel SDK registered the default global
// TracerProvider is a no-op — span.setAttribute/recordException/setStatus
// calls happen but land nowhere observable. Registering a real,
// in-memory-only BasicTracerProvider lets the loadPrompt-failure tests below
// inspect the actual "gen_ai.chat" span's status, confirming the span
// covering summarizeConversation/distillFoldIntoPreferences is marked ERROR
// even though writeDiscreteFold/maintainFoldWindow's own console.error-only
// catches (see memory.ts) swallow the exception before it ever reaches a
// caller.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// memory.ts's own orchestration (trim -> id correlation -> watermark filter
// -> summarize-and-upsert) is under test here, so db.ts's queries are mocked
// directly rather than mocking createAdminClient underneath them.
const loadRecentMessagesMock = vi.fn();
const getGuestMemoryMock = vi.fn();
const advanceGuestMemoryWatermarkMock = vi.fn();
const insertGuestMemoryFoldMock = vi.fn();
const loadGuestMemoryFoldsMock = vi.fn();
const deleteGuestMemoryFoldMock = vi.fn();
const updateGuestMemoryPreferencesMock = vi.fn();
vi.mock("@/lib/db.js", () => ({
  loadRecentMessages: loadRecentMessagesMock,
  getGuestMemory: getGuestMemoryMock,
  advanceGuestMemoryWatermark: advanceGuestMemoryWatermarkMock,
  insertGuestMemoryFold: insertGuestMemoryFoldMock,
  loadGuestMemoryFolds: loadGuestMemoryFoldsMock,
  deleteGuestMemoryFold: deleteGuestMemoryFoldMock,
  updateGuestMemoryPreferences: updateGuestMemoryPreferencesMock,
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

const { loadMemory, foldMemory, buildMemoryMessage } = await import("@/agent/memory.js");

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

// 8 rows of 1100 chars (223 real tokens) each, oldest-first — same shape as
// context.test.ts's over-budget fixture: 1784 tokens total, just over
// MAX_CONTEXT_TOKENS (1600), trims down to the newest 3 (669 tokens, under
// KEEP_CONTEXT_TOKENS), dropping the oldest 5.
function overflowingRows() {
  return Array.from({ length: 8 }, (_, i) =>
    messageRow(`msg-${i}`, i % 2 === 0 ? "user" : "assistant", 1100, `2026-08-0${i + 1}T00:00:00Z`),
  );
}

// Two distinct prompts now live behind loadPrompt: conversation-summarizer
// (summarizeConversation, {{prior_summary}}/{{transcript}}) and
// guest-preferences-distiller (distillFoldIntoPreferences,
// {{prior_preferences}}/{{fold_summary}}) — branches on the requested slug
// so both foldMemory's own two summarizer calls and maintainFoldWindow's
// distillation call each get their own real-shaped template rendering.
function mockLoadPrompt() {
  loadPromptMock.mockImplementation(async ({ slug }: { slug: string }) => {
    if (slug === "guest-preferences-distiller") {
      return {
        build: ({
          prior_preferences,
          fold_summary,
        }: {
          prior_preferences: string;
          fold_summary: string;
        }) => ({
          messages: [
            { role: "system", content: "You maintain a durable preferences profile..." },
            {
              role: "user",
              content: `Known preferences so far:\n${prior_preferences}\n\nRetiring fold summary:\n${fold_summary}\n\nReturn only the updated preferences text.`,
            },
          ],
        }),
      };
    }
    return {
      build: ({ prior_summary, transcript }: { prior_summary: string; transcript: string }) => ({
        messages: [
          { role: "system", content: "You compress an older stretch..." },
          {
            role: "user",
            content: `Prior summary:\n${prior_summary}\n\nFold in this older part of the conversation:\n${transcript}\n\nReturn the updated summary.`,
          },
        ],
      }),
    };
  });
}

describe("loadMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPrompt();
    // Default: no discrete folds — individual tests override this to cover
    // the fold-bearing combinations below.
    loadGuestMemoryFoldsMock.mockResolvedValue([]);
  });

  it("passes through untrimmed history and a null memoryMessage when nothing overflows, no preferences, no folds", async () => {
    const rows = [
      messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z"),
      messageRow("msg-2", "assistant", 50, "2026-08-01T00:01:00Z"),
      messageRow("msg-3", "user", 50, "2026-08-01T00:02:00Z"),
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);

    const result = await loadMemory({ conversationId: "convo-1", phone: "+351900000001" });

    expect(result.historyMessages).toHaveLength(3);
    expect(result.memoryMessage).toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(advanceGuestMemoryWatermarkMock).not.toHaveBeenCalled();
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
    expect(advanceGuestMemoryWatermarkMock).not.toHaveBeenCalled();
    expect(result.memoryMessage).toBeNull();
  });

  // Regression test for the raw-history/fold overlap bug: loadMemoryState
  // used to trim to the token budget FIRST and only consult the watermark
  // afterward (purely to decide what's eligible to fold) — so a message
  // already folded into guest_memory_folds could still sit inside the
  // trailing token window and get sent to the model verbatim, on top of the
  // fold-derived summary already covering the same content. Fixed by
  // filtering to unfolded rows before trimming, so a folded row can never
  // reappear in historyMessages regardless of how much budget is left.
  it("excludes rows at/before the watermark from historyMessages even when the whole fetched window would still fit under the token budget", async () => {
    // 5 short rows — nowhere near MAX_CONTEXT_TOKENS as a whole, so under
    // the old (trim-first) logic none of them would get trimmed at all and
    // msg-0..msg-2 would still show up verbatim in historyMessages despite
    // already being folded (watermark at msg-2).
    const rows = [
      messageRow("msg-0", "user", 50, "2026-08-01T00:00:00Z"),
      messageRow("msg-1", "assistant", 50, "2026-08-01T00:01:00Z"),
      messageRow("msg-2", "user", 50, "2026-08-01T00:02:00Z"),
      messageRow("msg-3", "assistant", 50, "2026-08-01T00:03:00Z"),
      messageRow("msg-4", "user", 50, "2026-08-01T00:04:00Z"),
    ];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: "msg-2",
      preferencesSummary: null,
    });
    expect(estimateTokens(rows.map((r) => ({ role: r.role, content: r.content })))).toBeLessThan(
      800,
    );

    const result = await loadMemory({ conversationId: "convo-overlap", phone: "+351900000030" });

    // Only the rows strictly after the watermark (msg-3, msg-4) survive —
    // msg-0..msg-2 are excluded even though the full 5-row set fits
    // comfortably under KEEP_CONTEXT_TOKENS.
    expect(result.historyMessages).toHaveLength(2);
    const contents = result.historyMessages.map((m) => m.content);
    expect(contents.some((c) => typeof c === "string" && c.includes("msg-3:"))).toBe(true);
    expect(contents.some((c) => typeof c === "string" && c.includes("msg-4:"))).toBe(true);
    expect(contents.some((c) => typeof c === "string" && c.includes("msg-0:"))).toBe(false);
    expect(contents.some((c) => typeof c === "string" && c.includes("msg-1:"))).toBe(false);
    expect(contents.some((c) => typeof c === "string" && c.includes("msg-2:"))).toBe(false);
  });

  it("builds memoryMessage from preferences_summary + the one recent fold (MAX_RECENT_FOLDS caps loadGuestMemoryFolds at one row)", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: "msg-4",
      preferencesSummary: "Guest is vegetarian, prefers a quiet room.",
    });
    loadGuestMemoryFoldsMock.mockResolvedValue([
      {
        id: "fold-1",
        summaryText: "Confirmed a booking for Room 2, September 18-20.",
        messageIdFrom: "msg-c",
        messageIdTo: "msg-d",
        createdAt: "2026-08-02T00:00:00Z",
      },
    ]);

    const result = await loadMemory({ conversationId: "convo-3", phone: "+351900000003" });

    expect(result.historyMessages).toHaveLength(3);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(advanceGuestMemoryWatermarkMock).not.toHaveBeenCalled();
    expect(result.memoryMessage).toEqual({
      role: "assistant",
      content:
        "User preferences:\nGuest is vegetarian, prefers a quiet room.\n\n" +
        "Summary of earlier conversation:\n" +
        "Confirmed a booking for Room 2, September 18-20.",
    });
  });

  it("builds memoryMessage from preferences only when there are no recent folds", async () => {
    const rows = [messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z")];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: null,
      preferencesSummary: "Guest is vegetarian.",
    });
    loadGuestMemoryFoldsMock.mockResolvedValue([]);

    const result = await loadMemory({ conversationId: "convo-4", phone: "+351900000004" });

    expect(result.memoryMessage).toEqual({
      role: "assistant",
      content: "User preferences:\nGuest is vegetarian.",
    });
  });

  it("builds memoryMessage from the one recent fold only, when there are no durable preferences yet", async () => {
    const rows = [messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z")];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: null,
      preferencesSummary: null,
    });
    loadGuestMemoryFoldsMock.mockResolvedValue([
      {
        id: "fold-1",
        summaryText: "Asked about check-in time.",
        messageIdFrom: "msg-a",
        messageIdTo: "msg-b",
        createdAt: "2026-08-01T00:00:00Z",
      },
    ]);

    const result = await loadMemory({ conversationId: "convo-5", phone: "+351900000005" });

    expect(result.memoryMessage).toEqual({
      role: "assistant",
      content: "Summary of earlier conversation:\nAsked about check-in time.",
    });
  });

  it("returns a null memoryMessage when guest_memory exists but preferences and folds are both empty", async () => {
    const rows = [messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z")];
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: null,
      preferencesSummary: null,
    });
    loadGuestMemoryFoldsMock.mockResolvedValue([]);

    const result = await loadMemory({ conversationId: "convo-6", phone: "+351900000006" });

    expect(result.memoryMessage).toBeNull();
  });

  // loadGuestMemoryFolds must run concurrently with loadMemoryState's own
  // internal loadRecentMessages/getGuestMemory fetch, not serially after
  // it — resolves all three mocks off a shared "still pending" flag so a
  // serial implementation (awaiting loadMemoryState fully before calling
  // loadGuestMemoryFolds) would deadlock this test via fake timers instead
  // of silently passing.
  it("fetches recent folds concurrently with the existing guest_memory state, not serially after it", async () => {
    vi.useFakeTimers();
    try {
      const rows = [messageRow("msg-1", "user", 50, "2026-08-01T00:00:00Z")];
      let recentMessagesStarted = false;
      let foldsStarted = false;

      loadRecentMessagesMock.mockImplementation(async () => {
        recentMessagesStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return rows;
      });
      getGuestMemoryMock.mockResolvedValue(null);
      loadGuestMemoryFoldsMock.mockImplementation(async () => {
        foldsStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [];
      });

      const resultPromise = loadMemory({ conversationId: "convo-7", phone: "+351900000007" });

      // Let microtasks/the initial synchronous portion of both calls run
      // before either timer fires — if loadGuestMemoryFolds were called only
      // after loadMemoryState resolves, foldsStarted would still be false
      // here.
      await vi.advanceTimersByTimeAsync(0);
      expect(recentMessagesStarted).toBe(true);
      expect(foldsStarted).toBe(true);

      await vi.advanceTimersByTimeAsync(10);
      await resultPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("foldMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    mockLoadPrompt();
    // Default: fold count already at/under MAX_RECENT_FOLDS, so
    // maintainFoldWindow (run unconditionally after every foldMemory call)
    // is a true no-op unless a test overrides this — see the "maintains the
    // MAX_RECENT_FOLDS cap" describe block below for the cases that do.
    loadGuestMemoryFoldsMock.mockResolvedValue([]);
  });

  it("summarizes once and writes the discrete fold plus the watermark when overflow drops rows newer than the existing watermark (or with no watermark at all)", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: null,
    });
    generateTextMock.mockResolvedValue({ text: "Standalone: guest asked about rooms 1-3." });

    await foldMemory({
      conversationId: "convo-2",
      // Already-normalized (bare) form — the webhook route normalizes
      // once, at the ingress boundary, before foldMemory ever sees `phone`.
      phone: "+351900000002",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    // Exactly one summarizer call per fold event — the discrete-fold-row
    // call, prior_summary forced to "" (renders as the template's "(none)"
    // fallback) regardless of what existingMemory carries. Sees the
    // newly-dropped rows (msg-0..msg-4); not msg-5, which stayed in the
    // trimmed window.
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [[call]] = generateTextMock.mock.calls as [{ messages: Array<{ content: string }> }][];
    expect(call.messages[1].content).toContain("Prior summary:\n(none)");
    expect(call.messages[1].content).toContain("msg-0");
    expect(call.messages[1].content).toContain("msg-4");
    expect(call.messages[1].content).not.toContain("msg-5:");

    // The discrete-fold-row write: standalone summary text, spanning
    // exactly the newly-dropped rows (msg-0 oldest .. msg-4 newest).
    expect(insertGuestMemoryFoldMock).toHaveBeenCalledWith({
      phoneNumber: "+351900000002",
      summaryText: "Standalone: guest asked about rooms 1-3.",
      messageIdFrom: "msg-0",
      messageIdTo: "msg-4",
    });

    // The watermark advances under exactly the phone value foldMemory was
    // given — it does no normalization of its own — to the newest of the
    // newly-folded-in dropped rows (msg-4 — the last of msg-0..msg-4).
    expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledWith("+351900000002", "msg-4");
  });

  it("skips the model call and the writes when every dropped row is already covered by the existing watermark", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    // Watermark already covers msg-0..msg-4 (all 5 rows this turn drops) —
    // the mechanism should be fully self-throttling here.
    getGuestMemoryMock.mockResolvedValue({
      summarizedThroughMessageId: "msg-4",
    });

    await foldMemory({
      conversationId: "convo-3",
      phone: "+351900000003",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(advanceGuestMemoryWatermarkMock).not.toHaveBeenCalled();
    expect(insertGuestMemoryFoldMock).not.toHaveBeenCalled();
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
    expect(advanceGuestMemoryWatermarkMock).not.toHaveBeenCalled();
    expect(insertGuestMemoryFoldMock).not.toHaveBeenCalled();
  });

  it("still advances the watermark when the discrete-fold-row write fails", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);
    generateTextMock.mockResolvedValue({ text: "Guest asked about rooms 1-3, no booking yet." });
    insertGuestMemoryFoldMock.mockRejectedValue(new Error("insert failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      foldMemory({
        conversationId: "convo-2",
        phone: "+351900000002",
        traceAnchor: TEST_TRACE_ANCHOR,
      }),
    ).resolves.toBeUndefined();

    // The watermark advance must complete even though the discrete-fold
    // table's write rejected — a guest_memory_folds failure is no worse
    // than a fold not having happened for that table, recoverable next fold.
    expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledWith("+351900000002", "msg-4");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // Regression test for the bug this fix addresses: summarizeConversation
  // used to call loadPrompt() BEFORE opening its withTurnSpan, so a
  // Braintrust failure there threw with no span open yet to record it on.
  // Now loadPrompt() runs inside the span callback (matching run-turn.ts's
  // loadSystemPromptText), so withTurnSpan's own catch (tracing.ts) marks
  // the span ERROR before writeDiscreteFold's console.error-only catch
  // swallows the exception. The swallow-and-continue behavior itself is
  // unchanged and intentional (see writeDiscreteFold's own comment) — this
  // only asserts the span is no longer silently unmarked.
  it("marks the gen_ai.chat span ERROR when loadPrompt rejects for the discrete-fold summarizer, even though writeDiscreteFold's own catch still swallows the error", async () => {
    const rows = overflowingRows();
    loadRecentMessagesMock.mockResolvedValue(rows);
    getGuestMemoryMock.mockResolvedValue(null);
    const promptError = new Error("braintrust unreachable");
    loadPromptMock.mockRejectedValueOnce(promptError);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      foldMemory({
        conversationId: "convo-2",
        phone: "+351900000002",
        traceAnchor: TEST_TRACE_ANCHOR,
      }),
    ).resolves.toBeUndefined();

    // loadPrompt threw before generateText was ever reached, and before the
    // discrete-fold row was ever written — but the watermark still advances
    // (writeDiscreteFold's failure is isolated from advanceGuestMemoryWatermark
    // by their shared Promise.all in foldMemory), exactly like the
    // insertGuestMemoryFold-rejects test above.
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(insertGuestMemoryFoldMock).not.toHaveBeenCalled();
    expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledWith("+351900000002", "msg-4");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const chatSpan = spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.chat");
    expect(chatSpan).toBeDefined();
    expect(chatSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(chatSpan?.status.message).toBe(promptError.message);

    consoleErrorSpy.mockRestore();
  });

  // maintainFoldWindow (MAX_RECENT_FOLDS = 1) runs after every real fold
  // event — these exercise that cap enforcement specifically, independent of
  // the writeDiscreteFold/advanceGuestMemoryWatermark assertions above.
  describe("maintains the MAX_RECENT_FOLDS cap", () => {
    // Minimal fixture that always overflows the trim budget so
    // writeDiscreteFold actually runs (see overflowingRows()'s own comment)
    // — the cap-enforcement behavior under test here is orthogonal to that
    // overflow logic, this fixture is just what makes foldMemory do real
    // work per call.
    function setUpBasicFold() {
      const rows = overflowingRows();
      loadRecentMessagesMock.mockResolvedValue(rows);
      getGuestMemoryMock.mockResolvedValue({
        summarizedThroughMessageId: null,
        preferencesSummary: "Guest is vegetarian.",
      });
      generateTextMock.mockImplementation(
        async ({ messages }: { messages: Array<{ content: string }> }) => {
          const userContent = messages[1].content;
          if (userContent.includes("Retiring fold summary:")) {
            return { text: "Distilled: vegetarian, prefers a quiet room." };
          }
          return { text: "Standalone fold summary." };
        },
      );
    }

    it("leaves guest_memory_folds untouched when the count stays at or under the cap", async () => {
      setUpBasicFold();
      loadGuestMemoryFoldsMock.mockResolvedValue([
        {
          id: "fold-1",
          summaryText: "Fold 1 text.",
          messageIdFrom: "msg-a",
          messageIdTo: "msg-b",
          createdAt: "2026-08-01T00:00:00Z",
        },
      ]);

      await foldMemory({
        conversationId: "convo-cap-1",
        phone: "+351900000020",
        traceAnchor: TEST_TRACE_ANCHOR,
      });

      // Only the one discrete-fold summarizer call — no distillation call
      // on top.
      expect(generateTextMock).toHaveBeenCalledTimes(1);
      expect(deleteGuestMemoryFoldMock).not.toHaveBeenCalled();
      expect(updateGuestMemoryPreferencesMock).not.toHaveBeenCalled();
    });

    it("distills and deletes exactly the oldest row when a 2nd fold pushes the count over the cap", async () => {
      setUpBasicFold();
      loadGuestMemoryFoldsMock.mockResolvedValue([
        {
          id: "fold-oldest",
          summaryText: "Oldest fold summary text.",
          messageIdFrom: "msg-a",
          messageIdTo: "msg-b",
          createdAt: "2026-08-01T00:00:00Z",
        },
        {
          id: "fold-newest",
          summaryText: "Newest fold summary text.",
          messageIdFrom: "msg-e",
          messageIdTo: "msg-f",
          createdAt: "2026-08-03T00:00:00Z",
        },
      ]);

      await foldMemory({
        conversationId: "convo-cap-2",
        phone: "+351900000021",
        traceAnchor: TEST_TRACE_ANCHOR,
      });

      // The 1 discrete-fold summarizer call, plus exactly 1 distillation
      // call — not one per excess row's worth of possible confusion, just
      // the single row that's actually over the cap here.
      expect(generateTextMock).toHaveBeenCalledTimes(2);
      const distillCall = (
        generateTextMock.mock.calls as [{ messages: Array<{ content: string }> }][]
      ).find(([call]) => call.messages[1].content.includes("Retiring fold summary:"));
      expect(distillCall?.[0].messages[1].content).toContain("Oldest fold summary text.");
      expect(distillCall?.[0].messages[1].content).toContain("Guest is vegetarian.");
      expect(distillCall?.[0].messages[1].content).not.toContain("Newest fold summary text.");

      // Persisted via .update() (updateGuestMemoryPreferences), never via
      // advanceGuestMemoryWatermark — advanceGuestMemoryWatermark's only
      // call here is the watermark advance, which never carries preferences.
      expect(updateGuestMemoryPreferencesMock).toHaveBeenCalledExactlyOnceWith(
        "+351900000021",
        "Distilled: vegetarian, prefers a quiet room.",
      );
      expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledExactlyOnceWith(
        "+351900000021",
        "msg-4",
      );

      // Only the oldest row is deleted — the cap is restored to exactly
      // MAX_RECENT_FOLDS (1) by removing the single excess row, not by
      // clearing the table.
      expect(deleteGuestMemoryFoldMock).toHaveBeenCalledExactlyOnceWith("fold-oldest");
    });

    // Same regression coverage as the discrete-fold summarizer test above,
    // but for distillFoldIntoPreferences's own loadPrompt call — moved
    // inside its withTurnSpan callback by the same fix. Overrides
    // mockLoadPrompt()'s slug-branching (set in the outer beforeEach) so the
    // discrete-fold summarizer call still succeeds normally and only the
    // distillation call's loadPrompt rejects, to prove the two spans are
    // independent and only the failing one is marked.
    it("marks the gen_ai.chat span ERROR when loadPrompt rejects for the distillation call, even though maintainFoldWindow's own catch still swallows the error", async () => {
      setUpBasicFold();
      loadGuestMemoryFoldsMock.mockResolvedValue([
        {
          id: "fold-oldest",
          summaryText: "Oldest fold summary text.",
          messageIdFrom: "msg-a",
          messageIdTo: "msg-b",
          createdAt: "2026-08-01T00:00:00Z",
        },
        {
          id: "fold-newest",
          summaryText: "Newest fold summary text.",
          messageIdFrom: "msg-e",
          messageIdTo: "msg-f",
          createdAt: "2026-08-03T00:00:00Z",
        },
      ]);
      const distillError = new Error("braintrust prompt version not found");
      loadPromptMock.mockImplementation(async ({ slug }: { slug: string }) => {
        if (slug === "guest-preferences-distiller") {
          throw distillError;
        }
        return {
          build: ({
            prior_summary,
            transcript,
          }: {
            prior_summary: string;
            transcript: string;
          }) => ({
            messages: [
              { role: "system", content: "You compress an older stretch..." },
              {
                role: "user",
                content: `Prior summary:\n${prior_summary}\n\nFold in this older part of the conversation:\n${transcript}\n\nReturn the updated summary.`,
              },
            ],
          }),
        };
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        foldMemory({
          conversationId: "convo-cap-2",
          phone: "+351900000021",
          traceAnchor: TEST_TRACE_ANCHOR,
        }),
      ).resolves.toBeUndefined();

      // Only the discrete-fold summarizer's own generateText call happened —
      // the distillation call's loadPrompt threw before its generateText was
      // ever reached, so preferences are never updated/deleted, but the
      // watermark (unrelated to maintainFoldWindow) still advances.
      expect(generateTextMock).toHaveBeenCalledTimes(1);
      expect(updateGuestMemoryPreferencesMock).not.toHaveBeenCalled();
      expect(deleteGuestMemoryFoldMock).not.toHaveBeenCalled();
      expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledWith("+351900000021", "msg-4");
      expect(consoleErrorSpy).toHaveBeenCalled();

      const chatSpans = spanExporter
        .getFinishedSpans()
        .filter((span) => span.name === "gen_ai.chat");
      expect(chatSpans).toHaveLength(2);
      // First span: the discrete-fold summarizer, which succeeded.
      expect(chatSpans[0]?.status.code).not.toBe(SpanStatusCode.ERROR);
      // Second span: the distillation call, whose loadPrompt rejected.
      expect(chatSpans[1]?.status.code).toBe(SpanStatusCode.ERROR);
      expect(chatSpans[1]?.status.message).toBe(distillError.message);

      consoleErrorSpy.mockRestore();
    });

    it("a distillation failure doesn't affect the discrete-fold write or the watermark advance", async () => {
      setUpBasicFold();
      loadGuestMemoryFoldsMock.mockRejectedValue(new Error("guest_memory_folds read failed"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        foldMemory({
          conversationId: "convo-cap-3",
          phone: "+351900000022",
          traceAnchor: TEST_TRACE_ANCHOR,
        }),
      ).resolves.toBeUndefined();

      expect(advanceGuestMemoryWatermarkMock).toHaveBeenCalledExactlyOnceWith(
        "+351900000022",
        "msg-4",
      );
      expect(insertGuestMemoryFoldMock).toHaveBeenCalledExactlyOnceWith({
        phoneNumber: "+351900000022",
        summaryText: "Standalone fold summary.",
        messageIdFrom: "msg-0",
        messageIdTo: "msg-4",
      });
      expect(updateGuestMemoryPreferencesMock).not.toHaveBeenCalled();
      expect(deleteGuestMemoryFoldMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
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
    mockLoadPrompt();
    loadGuestMemoryFoldsMock.mockResolvedValue([]);
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
    generateTextMock.mockResolvedValue({ text: "Guest asked about booking Room 1." });

    await foldMemory({
      conversationId: "convo-url-4",
      phone: "+351900000013",
      traceAnchor: TEST_TRACE_ANCHOR,
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const [[call]] = generateTextMock.mock.calls as [{ messages: Array<{ content: string }> }][];
    expect(call.messages[1].content).toContain("[link]");
    expect(call.messages[1].content).not.toContain("https://");
  });

  it("measurably shrinks token count on a URL-heavy message using the real tokenizer", async () => {
    // Two-URL message (booking link + Google Maps link), shaped like a real
    // message measured at 231 tokens under the real tokenizer before
    // redaction.
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

describe("buildMemoryMessage", () => {
  function fold(id: string, summaryText: string, createdAt: string) {
    return {
      id,
      summaryText,
      messageIdFrom: `${id}-from`,
      messageIdTo: `${id}-to`,
      createdAt,
    };
  }

  it("returns null when both preferences and the fold are absent", () => {
    expect(buildMemoryMessage(null, null)).toBeNull();
  });

  it("returns only the labeled preferences section when there is no recent fold", () => {
    expect(buildMemoryMessage("Guest is vegetarian.", null)).toEqual({
      role: "assistant",
      content: "User preferences:\nGuest is vegetarian.",
    });
  });

  it("returns only the labeled recent-conversation section when there are no durable preferences", () => {
    expect(
      buildMemoryMessage(null, fold("fold-1", "Asked about room 2.", "2026-08-01T00:00:00Z")),
    ).toEqual({
      role: "assistant",
      content: "Summary of earlier conversation:\nAsked about room 2.",
    });
  });

  it("returns both labeled sections, preferences first, when both are present", () => {
    const result = buildMemoryMessage(
      "Guest is vegetarian, prefers a quiet room.",
      fold("fold-1", "Confirmed a booking for Room 2.", "2026-08-01T00:00:00Z"),
    );
    expect(result).toEqual({
      role: "assistant",
      content:
        "User preferences:\nGuest is vegetarian, prefers a quiet room.\n\n" +
        "Summary of earlier conversation:\n" +
        "Confirmed a booking for Room 2.",
    });
  });
});
