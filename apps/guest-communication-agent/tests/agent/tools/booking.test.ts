import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/agent/tools/config";
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

// updateSpanIO is a real fetch() to Braintrust's REST API — mocked the same
// way missing-info.test.ts/run-turn.test.ts mock it, everything else in
// tracing.ts (steppedSpan, etc.) stays real. Needed now that
// requestSendBookingLinkApproval/runSendBookingLink each patch their own
// span directly.
const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
});

const insertPendingOwnerDecisionMock = vi.fn();
const resolvePendingOwnerDecisionByCorrelationIdMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  insertPendingOwnerDecision: insertPendingOwnerDecisionMock,
  resolvePendingOwnerDecisionByCorrelationId: resolvePendingOwnerDecisionByCorrelationIdMock,
}));

const {
  runSendBookingLink,
  computeSendBookingLink,
  buildBookingApprovalReason,
  handleBookingLinkApprovalReceived,
  requestSendBookingLinkApproval,
  BOOKING_LINK_APPROVAL_EVENT,
} = await import("@/agent/tools/booking.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

// Minimal real ToolContext for runSendBookingLink's own tests below — only
// phone/step are actually read by that function's body, the rest just
// satisfies the type.
function bookingToolContext(step: GetStepTools<typeof inngest>): ToolContext {
  return {
    conversationId: "convo-1",
    phone: "+15551234567",
    traceAnchor: TEST_TRACE_ANCHOR,
    step,
  };
}

// Every date below is relative to this pinned clock — requestSendBookingLinkApproval
// re-verifies the range through computeCheckAvailability now, so a hardcoded
// "future" range would rot into a past_date refusal the day it passes.
const TODAY = new Date("2026-09-21T10:00:00.000Z");

const bookingArgs = {
  guestName: "Ana",
  email: "ana@example.com",
  room: "room1" as const,
  checkIn: "2026-10-11",
  checkOut: "2026-10-13",
};

// The past range from the 2026-09-21 incident: the model resolved "October
// 11-13" to 2025 and every layer downstream accepted it.
const pastBookingArgs = { ...bookingArgs, checkIn: "2025-10-11", checkOut: "2025-10-13" };

// computeSendBookingLink returns a refusal instead of a URL for an unusable
// range, so the URL tests have to narrow it.
function bookingUrl(result: ReturnType<typeof computeSendBookingLink>): string {
  if (!("url" in result)) {
    throw new Error(`expected a booking URL, got a refusal: ${result.error}`);
  }
  return result.url;
}

// That re-check is a real fetch() to GET /api/availability?room= — stubbed
// file-wide, defaulting to "nothing booked", so the happy paths below reach
// the owner nudge exactly as they did before the guard existed.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  // A fresh Response per call — a single shared one throws "Body is
  // unusable" on the second read.
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ bookings: [] }))));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("buildBookingApprovalReason", () => {
  it("builds the human-readable owner-facing reason string with European-formatted dates", () => {
    expect(buildBookingApprovalReason(bookingArgs)).toBe(
      "Ana wants to book room1 from 11-10-2026 to 13-10-2026.",
    );
  });

  it("falls back to the raw string for a date that isn't well-formed YYYY-MM-DD", () => {
    expect(buildBookingApprovalReason({ ...bookingArgs, checkIn: "20261011" })).toBe(
      "Ana wants to book room1 from 20261011 to 13-10-2026.",
    );
  });
});

describe("computeSendBookingLink", () => {
  it("returns { url } built from room/checkIn/checkOut, with no nudge/approval/tracing logic of its own", () => {
    const result = computeSendBookingLink(bookingArgs, "+15551234567");

    expect(result).toEqual({ url: expect.stringContaining("/booking/room1?") });
    expect(bookingUrl(result)).toContain("checkIn=2026-10-11");
    expect(bookingUrl(result)).toContain("checkOut=2026-10-13");
  });

  it("threads the guest's phone and source=gca so the website can prefill/attribute the booking", () => {
    const url = bookingUrl(computeSendBookingLink(bookingArgs, "+15551234567"));

    expect(url).toContain(`phone=${encodeURIComponent("+15551234567")}`);
    expect(url).toContain("source=gca");
  });

  it("threads the guest's name so the website can prefill it too", () => {
    const url = bookingUrl(computeSendBookingLink(bookingArgs, "+15551234567"));

    expect(url).toContain(`guestName=${encodeURIComponent("Ana")}`);
  });

  it("threads the guest's email so the website can prefill it too", () => {
    const url = bookingUrl(computeSendBookingLink(bookingArgs, "+15551234567"));

    expect(url).toContain(`email=${encodeURIComponent("ana@example.com")}`);
  });

  it("defaults the site origin when NEXT_PUBLIC_SITE_URL isn't set", () => {
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const url = bookingUrl(computeSendBookingLink(bookingArgs, "+15551234567"));
    expect(url).toContain("https://issebya.com/booking");

    if (original !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = original;
    }
  });

  it("builds no URL for the incident's past range, refusing with reason past_date", () => {
    const result = computeSendBookingLink(pastBookingArgs, "+15551234567");

    expect(result).toEqual({
      error:
        "Cannot build a booking link: check-in 2025-10-11 is in the past (today is 2026-09-21). Re-read the dates from your earlier tool result in this conversation and call the tool again with them.",
      reason: "past_date",
    });
    expect(result).not.toHaveProperty("url");
  });

  it("builds no URL for a zero-night stay, refusing with reason invalid_range", () => {
    const result = computeSendBookingLink(
      { ...bookingArgs, checkOut: bookingArgs.checkIn },
      "+15551234567",
    );

    expect(result).toMatchObject({ reason: "invalid_range" });
    expect(result).not.toHaveProperty("url");
  });
});

describe("runSendBookingLink", () => {
  type StepTools = GetStepTools<typeof inngest>;

  function makeStepMock() {
    return {
      run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    } as unknown as StepTools & { run: ReturnType<typeof vi.fn> };
  }

  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    step = makeStepMock();
  });

  it("returns the same { url } computeSendBookingLink would, wrapped in real step tracing", async () => {
    const result = await runSendBookingLink(bookingArgs, bookingToolContext(step));

    expect(result).toEqual(computeSendBookingLink(bookingArgs, "+15551234567"));
  });

  it("creates its own fresh gen_ai.tool.send_booking_link execution span with real output known at creation, no updateSpanIO patch", async () => {
    const result = await runSendBookingLink(bookingArgs, bookingToolContext(step));

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.send_booking_link");
    expect(execSpan).toBeDefined();
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("send_booking_link");
    expect(execSpan?.attributes["gca.tool.output"]).toBe(JSON.stringify(result));
    expect(updateSpanIOMock).not.toHaveBeenCalled();
  });

  it("memoizes the compute+span-creation under a single tool-send_booking_link step", async () => {
    await runSendBookingLink(bookingArgs, bookingToolContext(step));

    expect(step.run.mock.calls.map((c) => c[0])).toEqual(["tool-send_booking_link"]);
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
    expect(decision.hitlSpanId).toEqual(expect.any(String));
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

  it("refuses before nudging the owner when the room is already booked for those dates", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ bookings: [{ start: "2026-10-12", end: "2026-10-15" }] })),
    );

    const decision = await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(decision.approved).toBe(false);
    expect(decision.notApprovedOutput).toMatchObject({
      approved: false,
      reason: "not_available",
    });
    // The owner is never asked to approve a link that could not be built.
    expect(sendOwnerNudgeMock).not.toHaveBeenCalled();
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });

  it("refuses the incident's past range before nudging the owner, without fetching availability", async () => {
    const decision = await requestSendBookingLinkApproval(
      { ...call, input: pastBookingArgs as unknown as Record<string, unknown> },
      "corr-1",
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(decision.approved).toBe(false);
    expect(decision.notApprovedOutput).toMatchObject({ approved: false, reason: "past_date" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendOwnerNudgeMock).not.toHaveBeenCalled();
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });

  it("patches the gate span with the refusal under its own step id, distinct from the reject path's", async () => {
    const decision = await requestSendBookingLinkApproval(
      { ...call, input: pastBookingArgs as unknown as Record<string, unknown> },
      "corr-1",
      {
        conversationId: "convo-1",
        phone: "+3519",
        correlationId: "corr-1",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(updateSpanIOMock).toHaveBeenCalledWith(decision.hitlSpanId, {
      output: decision.notApprovedOutput,
    });

    const stepIds = step.run.mock.calls.map((c) => c[0]);
    expect(stepIds).toContain("verify-send_booking_link-availability");
    expect(stepIds).toContain("update-send_booking_link-refusal-trace-io");
    expect(stepIds).not.toContain("update-send_booking_link-trace-io");
  });

  it("creates the hitl.send_booking_link gate span first, as the nudge/decision spans' real parent — no gen_ai.tool.send_booking_link span exists on this path", async () => {
    step.waitForEvent.mockResolvedValueOnce({ data: { approved: true } });

    await requestSendBookingLinkApproval(call, "corr-1", {
      conversationId: "convo-1",
      phone: "+3519",
      correlationId: "corr-1",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(step.run.mock.calls.map((c) => c[0])[0]).toBe("hitl-send_booking_link");

    const hitlSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link");
    expect(hitlSpan?.attributes["gca.tool.input"]).toBe(JSON.stringify(call.input));
    expect(hitlSpan?.attributes["braintrust.tags"]).toEqual(["send_booking_link"]);

    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link.nudge");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["send_booking_link"]);

    const decisionSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "hitl.send_booking_link.decision");
    expect(decisionSpan?.attributes["gca.approval.decision"]).toBe("approved");

    // The real execution span only gets created by runSendBookingLink, once
    // run-tool.ts's runTool is actually called with the approved decision —
    // requestSendBookingLinkApproval on its own never creates one.
    expect(
      spanExporter.getFinishedSpans().find((span) => span.name === "gen_ai.tool.send_booking_link"),
    ).toBeUndefined();
  });
});
