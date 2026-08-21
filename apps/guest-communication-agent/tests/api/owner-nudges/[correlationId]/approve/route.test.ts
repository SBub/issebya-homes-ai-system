import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real, in-memory-only tracer provider (same setup the answer route's own
// test file uses), so this file's span-nesting/real-filter assertions below
// can inspect actual ReadableSpan objects instead of guessing at
// withTurnSpan/startTraceRoot's behavior.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// HTTP-layer concerns (auth, parsing, status mapping, span nesting) are
// tested here. The actual Inngest-send logic is mocked wholesale.
const handleBookingLinkApprovalReceivedMock = vi.fn();
vi.mock("@/agent/tools/booking.js", () => ({
  handleBookingLinkApprovalReceived: handleBookingLinkApprovalReceivedMock,
}));

// This route's own best-effort pending_owner_decisions bookkeeping — mocked
// at this module boundary, same style as handleBookingLinkApprovalReceived
// above.
const markPendingOwnerDecisionRelayedMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  markPendingOwnerDecisionRelayed: markPendingOwnerDecisionRelayedMock,
}));

// consumeApprovalGateTraceAnchor is this route's one real Supabase-backed
// call (see tracing.ts) — mocked the same "mock the module's exported
// external-call function directly" way the answer route's test file mocks
// consumeMissingInfoTraceAnchor.
//
// withTurnSpan/startTraceRoot are wrapped as spies over their REAL
// implementations rather than mocked away — see the answer route's own test
// file for the full reasoning (same harness limitation here).
const withTurnSpanSpy = vi.fn();
const startTraceRootSpy = vi.fn();
const consumeApprovalGateTraceAnchorMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  withTurnSpanSpy.mockImplementation(actual.withTurnSpan);
  startTraceRootSpy.mockImplementation(actual.startTraceRoot);
  return {
    ...actual,
    consumeApprovalGateTraceAnchor: consumeApprovalGateTraceAnchorMock,
    withTurnSpan: withTurnSpanSpy,
    startTraceRoot: startTraceRootSpy,
  };
});

const { POST } = await import("@/app/api/owner-nudges/[correlationId]/approve/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/owner-nudges/corr-abc-123/approve", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(correlationId: string) {
  return { params: Promise.resolve({ correlationId }) };
}

describe("POST /api/owner-nudges/[correlationId]/approve", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    handleBookingLinkApprovalReceivedMock.mockReset();
    handleBookingLinkApprovalReceivedMock.mockResolvedValue(undefined);
    consumeApprovalGateTraceAnchorMock.mockReset();
    // Default: no anchor found — exercises the disconnected-trace-root
    // fallback path.
    consumeApprovalGateTraceAnchorMock.mockResolvedValue(null);
    withTurnSpanSpy.mockClear();
    startTraceRootSpy.mockClear();
    spanExporter.reset();
    markPendingOwnerDecisionRelayedMock.mockReset();
    markPendingOwnerDecisionRelayedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ approved: true }, "wrong-key"),
      makeParams("corr-abc-123"),
    );
    expect(res.status).toBe(401);
    expect(handleBookingLinkApprovalReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when approved is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("corr-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing/invalid approved in request body" });
    expect(handleBookingLinkApprovalReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when approved is not a boolean", async () => {
    const res = await POST(makeRequest({ approved: "yes" }), makeParams("corr-abc-123"));
    expect(res.status).toBe(400);
    expect(handleBookingLinkApprovalReceivedMock).not.toHaveBeenCalled();
  });

  it("delegates to handleBookingLinkApprovalReceived with the correlation id and approved flag, and returns ok: true", async () => {
    const res = await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(handleBookingLinkApprovalReceivedMock).toHaveBeenCalledWith({
      correlationId: "corr-abc-123",
      approved: true,
    });
  });

  it("returns a 500 with the error message when handleBookingLinkApprovalReceived throws", async () => {
    handleBookingLinkApprovalReceivedMock.mockRejectedValueOnce(new Error("send boom"));

    const res = await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "send boom" });
  });

  it("marks the matching pending_owner_decisions row relayed after a successful approval", async () => {
    await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));

    expect(markPendingOwnerDecisionRelayedMock).toHaveBeenCalledWith("corr-abc-123");
  });

  it("marks the matching pending_owner_decisions row relayed after a successful rejection too", async () => {
    await POST(makeRequest({ approved: false }), makeParams("corr-abc-123"));

    expect(markPendingOwnerDecisionRelayedMock).toHaveBeenCalledWith("corr-abc-123");
  });

  it("does not call markPendingOwnerDecisionRelayed when handleBookingLinkApprovalReceived throws", async () => {
    handleBookingLinkApprovalReceivedMock.mockRejectedValueOnce(new Error("send boom"));

    await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));

    expect(markPendingOwnerDecisionRelayedMock).not.toHaveBeenCalled();
  });

  describe("owner_nudges.handle_approval span", () => {
    function findSpan(name: string): ReadableSpan {
      const span = spanExporter.getFinishedSpans().find((s) => s.name === name);
      if (!span) {
        throw new Error(`no finished span named "${name}"`);
      }
      return span;
    }

    it("nests under the real toolAnchor when consumeApprovalGateTraceAnchor finds one", async () => {
      const toolAnchor = { traceId: "1".repeat(32), spanId: "1".repeat(16) };
      consumeApprovalGateTraceAnchorMock.mockResolvedValueOnce(toolAnchor);

      await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));

      expect(withTurnSpanSpy).toHaveBeenCalledWith(
        toolAnchor,
        "owner_nudges.handle_approval",
        expect.any(Object),
        expect.any(Function),
      );
      expect(startTraceRootSpy).not.toHaveBeenCalled();
      expect(findSpan("owner_nudges.handle_approval")).toBeDefined();
    });

    it("falls back to its own disconnected trace root when no anchor is found", async () => {
      await POST(makeRequest({ approved: true }), makeParams("corr-abc-123"));

      expect(startTraceRootSpy).toHaveBeenCalledWith(
        "owner_nudges.handle_approval",
        expect.any(Object),
        expect.any(Function),
      );
      expect(withTurnSpanSpy).not.toHaveBeenCalled();

      const span = findSpan("owner_nudges.handle_approval");
      expect(span.attributes["gca.correlation_id"]).toBe("corr-abc-123");
    });
  });
});
