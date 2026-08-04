import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolates performEscalation directly, rather than driving it indirectly
// through runAgentTurn's step-cap branch. No more Supabase mocking here —
// performEscalation no longer touches the DB at all (the escalations table
// is gone); it only pushes a nudge through telegram-router.
const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

const { performEscalation } = await import("@/agent/tools/escalation-shared.js");

describe("performEscalation", () => {
  beforeEach(() => {
    sendEscalationNudgeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  for (const reasonCategory of ["wants_human", "missing_info"] as const) {
    it(`sends a telegram-router nudge and returns true on success for ${reasonCategory}`, async () => {
      sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true });

      const result = await performEscalation({
        conversationId: "convo-1",
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
      });

      expect(result).toBe(true);
      expect(sendEscalationNudgeMock).toHaveBeenCalledWith({
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
        conversationId: "convo-1",
        workflowId: undefined,
      });
    });
  }

  it("passes workflowId through when supplied (the real missing_info suspend/resume path)", async () => {
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is asking about the AC",
      reasonCategory: "missing_info",
      workflowId: "wf-abc-123",
    });

    expect(sendEscalationNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-abc-123" }),
    );
  });

  it("returns false and logs when the telegram-router nudge fails", async () => {
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: false, error: "telegram-router down" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await performEscalation({
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
