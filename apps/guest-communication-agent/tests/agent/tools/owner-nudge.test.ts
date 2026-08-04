import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolates requestOwnerNudge directly, rather than driving it indirectly
// through runAgentTurn's step-cap branch. No more Supabase mocking here —
// requestOwnerNudge no longer touches the DB at all (the escalations table
// is gone); it only pushes a nudge through telegram-router.
const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

// Immediately invokes the callback, matching how a real runStep behaves from
// the caller's perspective — requestOwnerNudge now emits an
// OwnerNudgeRequested event (wrapped in DBOS.runStep) on a successful nudge.
const dbosRunStepMock = vi.fn((fn: () => unknown) => fn());
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    runStep: dbosRunStepMock,
  },
}));

const { requestOwnerNudge } = await import("@/agent/tools/owner-nudge.js");

describe("requestOwnerNudge", () => {
  beforeEach(() => {
    sendOwnerNudgeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  for (const reasonCategory of ["wants_human", "missing_info"] as const) {
    it(`sends a telegram-router nudge and returns true on success for ${reasonCategory}`, async () => {
      sendOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

      const result = await requestOwnerNudge({
        conversationId: "convo-1",
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
      });

      expect(result).toBe(true);
      expect(sendOwnerNudgeMock).toHaveBeenCalledWith({
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
        conversationId: "convo-1",
        workflowId: undefined,
      });
    });
  }

  it("passes workflowId through when supplied (the real missing_info suspend/resume path)", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    await requestOwnerNudge({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is asking about the AC",
      reasonCategory: "missing_info",
      workflowId: "wf-abc-123",
    });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-abc-123" }),
    );
  });

  it("returns false and logs when the telegram-router nudge fails", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "telegram-router down" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestOwnerNudge({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest asked something unanswerable",
      reasonCategory: "missing_info",
    });

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
