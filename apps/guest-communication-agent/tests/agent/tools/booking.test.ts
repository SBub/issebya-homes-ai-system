import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// booking.ts's runSendBookingLink/buildBookingApprovalReason stay pure URL/
// reason-string builders — but requestSendBookingLinkApproval (this app's
// run<ToolName> "calls human" half, see missing-info.ts's
// requestMissingInfoApproval for the model this follows) is a deliberate
// exception to that purity, reusing the real approve/reject HITL mechanism
// in approval-gate.ts (see approval-gate.test.ts for that mechanism's own
// coverage — kept real here, not mocked, since it's genuinely reused, not
// reimplemented). Same in-memory OTel wiring as missing-info.test.ts/
// wants-human.test.ts, so its span assertions inspect a real span's
// attributes instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock },
}));

const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const insertPendingOwnerDecisionMock = vi.fn();
const resolvePendingOwnerDecisionByCorrelationIdMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  insertPendingOwnerDecision: insertPendingOwnerDecisionMock,
  resolvePendingOwnerDecisionByCorrelationId: resolvePendingOwnerDecisionByCorrelationIdMock,
}));

const {
  runSendBookingLink,
  buildBookingApprovalReason,
  handleBookingLinkApprovalReceived,
  requestSendBookingLinkApproval,
  BOOKING_LINK_APPROVAL_EVENT,
} = await import("@/agent/tools/booking.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

const bookingArgs = {
  guestName: "Ana",
  email: "ana@example.com",
  room: "room1" as const,
  checkIn: "2026-09-01",
  checkOut: "2026-09-05",
};

describe("buildBookingApprovalReason", () => {
  it("builds the human-readable owner-facing reason string with European-formatted dates", () => {
    expect(buildBookingApprovalReason(bookingArgs)).toBe(
      "Ana wants to book room1 from 01-09-2026 to 05-09-2026.",
    );
  });

  it("falls back to the raw string for a date that isn't well-formed YYYY-MM-DD", () => {
    expect(buildBookingApprovalReason({ ...bookingArgs, checkIn: "20260901" })).toBe(
      "Ana wants to book room1 from 20260901 to 05-09-2026.",
    );
  });
});

describe("runSendBookingLink", () => {
  it("returns { url } built from room/checkIn/checkOut, with no nudge/approval logic of its own", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result).toEqual({ url: expect.stringContaining("/booking/room1?") });
    expect(result.url).toContain("checkIn=2026-09-01");
    expect(result.url).toContain("checkOut=2026-09-05");
  });

  it("threads the guest's phone and source=gca so the website can prefill/attribute the booking", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`phone=${encodeURIComponent("+15551234567")}`);
    expect(result.url).toContain("source=gca");
  });

  it("threads the guest's name so the website can prefill it too", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`guestName=${encodeURIComponent("Ana")}`);
  });

  it("threads the guest's email so the website can prefill it too", async () => {
    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });

    expect(result.url).toContain(`email=${encodeURIComponent("ana@example.com")}`);
  });

  it("defaults the site origin when NEXT_PUBLIC_SITE_URL isn't set", async () => {
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const result = await runSendBookingLink(bookingArgs, { phone: "+15551234567" });
    expect(result.url).toContain("https://issebya.com/booking");

    if (original !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = original;
    }
  });
});

describe("handleBookingLinkApprovalReceived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
  });

  it("sends the booking-link approval event with the correlation id and decision", async () => {
    await handleBookingLinkApprovalReceived({ correlationId: "corr-abc-123", approved: true });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: BOOKING_LINK_APPROVAL_EVENT,
      data: { correlationId: "corr-abc-123", approved: true },
    });
  });

  it("relays a rejection the same way", async () => {
    await handleBookingLinkApprovalReceived({ correlationId: "corr-abc-123", approved: false });

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: BOOKING_LINK_APPROVAL_EVENT,
      data: { correlationId: "corr-abc-123", approved: false },
    });
  });
});

describe("requestSendBookingLinkApproval", () => {
  type StepTools = GetStepTools<typeof inngest>;

  // Only `run`/`waitForEvent` are exercised by real code here — see
  // approval-gate.test.ts's own makeStepMock comment for why the rest of the
  // real StepTools surface is cast away rather than stubbed out.
  function makeStepMock() {
    return {
      run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
      waitForEvent: vi.fn(),
    } as unknown as StepTools & {
      run: ReturnType<typeof vi.fn>;
      waitForEvent: ReturnType<typeof vi.fn>;
    };
  }

  const call = {
    toolCallId: "call-1",
    toolName: "send_booking_link",
    input: bookingArgs as unknown as Record<string, unknown>,
  };

  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
    insertPendingOwnerDecisionMock.mockResolvedValue(undefined);
    resolvePendingOwnerDecisionByCorrelationIdMock.mockResolvedValue(undefined);
  });

  it("sends the owner nudge with buildBookingApprovalReason's text under reasonCategory 'send_booking_link'", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-1",
        phone: "+3519",
        reason: buildBookingApprovalReason(bookingArgs),
        reasonCategory: "send_booking_link",
        correlationId: "corr-1",
      }),
    );
  });

  it("resolves approved: true, with no payload, when the owner approves", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    const decision = await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(decision.approved).toBe(true);
    expect(decision.payload).toBeUndefined();
    expect(decision.notApprovedOutput).toBeUndefined();
    expect(decision.toolSpanId).toEqual(expect.any(String));
  });

  it("resolves approved: false with the standard not-approved message on a rejection", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: false } });

    const decision = await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(decision.approved).toBe(false);
    expect(decision.notApprovedOutput).toEqual({
      approved: false,
      message: "This action was not approved. Do not retry it automatically.",
    });
  });

  it("resolves approved: false the same way on a timeout (no decision arrives)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);

    const decision = await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(decision.approved).toBe(false);
    expect(decision.notApprovedOutput).toEqual({
      approved: false,
      message: "This action was not approved. Do not retry it automatically.",
    });
  });

  it("creates the gen_ai.tool.send_booking_link execution span first, before the nudge", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(step.run.mock.calls.map((c) => c[0])[0]).toBe("tool-send_booking_link");

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("send_booking_link");
    expect(execSpan?.attributes["gca.tool.input"]).toBe(JSON.stringify(call.input));

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.send_booking_link");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["send_booking_link"]);

    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("approved");
  });
});
