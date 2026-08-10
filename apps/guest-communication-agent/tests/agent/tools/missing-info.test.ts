import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// missing-info.ts is now the pure remainder of the missing_info flow: the
// tool schema/declaration, the shared event/timeout constants, and both
// non-step branches of what happens once a nudge is settled. The real
// suspend/wait (nudge-send step, step.waitForEvent, no-reply-timeout
// fallback step) moved into run-turn.ts's private runMissingInfo — see
// run-turn.test.ts's "missing_info" coverage for that behavior now (it can
// only be exercised indirectly through runAgentTurn, since runMissingInfo
// isn't exported from run-turn.ts).
//
// Mocks every real external boundary this file still touches: Postgres (the
// documents insert), the embedding call, and inngest.send — there's no more
// `step` here at all, so no hand-rolled step mock is needed.
const mockDocInsert = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "documents") return { insert: mockDocInsert };
  throw new Error(`missing-info.test.ts mockFrom: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const embedMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, embed: embedMock };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
}));

const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

const { handleMissingInfoNoReply, handleMissingInfoReplyReceived, OWNER_NUDGE_ANSWERED_EVENT } =
  await import("@/agent/tools/missing-info.js");

const MISSING_INFO_REPLY_TIMEOUT = "24h";

describe("handleMissingInfoNoReply", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves after logging — no DB side effects", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleMissingInfoNoReply({ correlationId: "corr-abc-123" }),
    ).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-abc-123"));
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(MISSING_INFO_REPLY_TIMEOUT),
    );
    expect(mockFrom).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe("handleMissingInfoReplyReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    mockDocInsert.mockResolvedValue({ error: null });
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("embeds the answer, inserts into documents, then sends the owner-nudge-answered event with the correlation id", async () => {
    await handleMissingInfoReplyReceived({
      correlationId: "corr-abc-123",
      answer: "The AC is above the bed",
    });

    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );
    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(mockDocInsert).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_nudge_answer" },
    });

    // Order matters (per the app owner): the KB embed/insert must happen
    // BEFORE the event that wakes a suspended run is sent.
    const docInsertOrder = mockDocInsert.mock.invocationCallOrder[0];
    const sendOrder = inngestSendMock.mock.invocationCallOrder[0];
    expect(docInsertOrder).toBeLessThan(sendOrder);

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: OWNER_NUDGE_ANSWERED_EVENT,
      data: { correlationId: "corr-abc-123", answer: "The AC is above the bed" },
    });
  });

  it("throws when the documents insert fails, before touching inngest.send", async () => {
    mockDocInsert.mockResolvedValueOnce({ error: { message: "insert boom" } });

    await expect(
      handleMissingInfoReplyReceived({
        correlationId: "corr-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("insert boom");

    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("rethrows an inngest.send failure rather than swallowing it — there's no equivalent to DBOS's 'workflow doesn't exist' case to catch", async () => {
    inngestSendMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      handleMissingInfoReplyReceived({
        correlationId: "corr-abc-123",
        answer: "The AC is above the bed",
      }),
    ).rejects.toThrow("connection reset");
  });
});
