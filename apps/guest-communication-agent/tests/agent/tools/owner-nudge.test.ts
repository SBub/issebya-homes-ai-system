import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// Isolates requestOwnerNudge directly, rather than driving it indirectly
// through runAgentTurn's step-cap branch. No more Supabase mocking here —
// requestOwnerNudge no longer touches the DB at all (the escalations table
// is gone); it only pushes a nudge through telegram-router. `step` is a
// hand-rolled mock (run-turn.ts now threads it in as a plain explicit
// parameter rather than an ambient DBOS import), matching the rest of this
// app's test style.
const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const { requestOwnerNudge } = await import("@/agent/tools/owner-nudge.js");

type StepTools = GetStepTools<typeof inngest>;

// Only `run` is exercised by real code here — the rest of the real
// StepTools surface is cast away rather than stubbed out, since nothing
// under test calls it.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools & {
    run: ReturnType<typeof vi.fn>;
    waitForEvent: ReturnType<typeof vi.fn>;
  };
}

describe("requestOwnerNudge", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    sendOwnerNudgeMock.mockReset();
    step = makeStepMock();
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
        step,
      });

      expect(result).toBe(true);
      expect(sendOwnerNudgeMock).toHaveBeenCalledWith({
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
        conversationId: "convo-1",
        correlationId: undefined,
      });
    });
  }

  it("passes correlationId through when supplied (the real missing_info suspend/resume path)", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    await requestOwnerNudge({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is asking about the AC",
      reasonCategory: "missing_info",
      correlationId: "corr-abc-123",
      step,
    });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "corr-abc-123" }),
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
      step,
    });

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
