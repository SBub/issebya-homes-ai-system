import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// Same in-memory OTel wiring as run-turn.test.ts, so the braintrust.tags
// assertion below can inspect a real span's attributes instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// Mocks every real external boundary: telegram-router (the owner nudge send)
// and inngest.send — this is exactly what the old booking.test.ts's
// waitForBookingLinkApproval/runSendBookingLink suspend-logic coverage
// mocked, ported here since that's the mechanism this file now owns.
const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

const { requestApprovalGate, resolveToolApproval } = await import("@/agent/tools/approval-gate.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

type StepTools = GetStepTools<typeof inngest>;

// Only `run`/`waitForEvent` are exercised by real code here — see
// booking.test.ts's original comment for why the rest of the real StepTools
// surface is cast away rather than stubbed out.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools & {
    run: ReturnType<typeof vi.fn>;
    waitForEvent: ReturnType<typeof vi.fn>;
  };
}

// Stand-in for what run-turn.ts's APPROVAL_GATES table would pass for
// sendBookingLink — this file tests the generic mechanism, not any one
// tool's policy, but needs some concrete values to call it with.
const gateParamsBase = {
  toolName: "sendBookingLink",
  event: "gca/booking-link.approval",
  timeout: "52w",
  reason: "Ana wants to book room1 from 01-09-2026 to 05-09-2026.",
  reasonCategory: "send_booking_link" as const,
  conversationId: "convo-1",
  phone: "+351920742845",
  correlationId: "corr-abc-123",
  traceAnchor: TEST_TRACE_ANCHOR,
};

describe("requestApprovalGate", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
  });

  it("sends the Telegram nudge with the given reasonCategory, reason, and correlationId", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestApprovalGate({ ...gateParamsBase, step });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+351920742845",
        conversationId: "convo-1",
        reasonCategory: "send_booking_link",
        correlationId: "corr-abc-123",
        reason: gateParamsBase.reason,
      }),
    );
  });

  it("tags the nudge span's braintrust.tags with the given toolName", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestApprovalGate({ ...gateParamsBase, step });

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.sendBookingLink");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["sendBookingLink"]);
  });

  it("calls step.waitForEvent with the given event, matching on data.correlationId, and the given timeout", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestApprovalGate({ ...gateParamsBase, step });

    expect(step.waitForEvent).toHaveBeenCalledWith("wait-for-sendBookingLink-approval", {
      event: "gca/booking-link.approval",
      match: "data.correlationId",
      timeout: "52w",
    });
  });

  it("returns true when the event resolves with approved: true", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    const result = await requestApprovalGate({ ...gateParamsBase, step });

    expect(result).toBe(true);
  });

  it("returns false when the event resolves with approved: false", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });

    const result = await requestApprovalGate({ ...gateParamsBase, step });

    expect(result).toBe(false);
  });

  it("returns false and logs a warning when step.waitForEvent times out (resolves null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestApprovalGate({ ...gateParamsBase, step });

    expect(result).toBe(false);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("corr-abc-123"));
    consoleWarnSpy.mockRestore();
  });

  it("short-circuits to false without calling step.waitForEvent when the nudge itself failed to send", async () => {
    sendOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestApprovalGate({ ...gateParamsBase, step });

    expect(result).toBe(false);
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });
});

describe("resolveToolApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("sends the given event with the correlation id and decision", async () => {
    await resolveToolApproval({
      event: "gca/booking-link.approval",
      correlationId: "corr-abc-123",
      approved: true,
    });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "gca/booking-link.approval",
      data: { correlationId: "corr-abc-123", approved: true },
    });
  });

  it("relays a rejection the same way", async () => {
    await resolveToolApproval({
      event: "gca/booking-link.approval",
      correlationId: "corr-abc-123",
      approved: false,
    });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "gca/booking-link.approval",
      data: { correlationId: "corr-abc-123", approved: false },
    });
  });
});
