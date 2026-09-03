import { BraintrustSpanProcessor } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real, in-memory-only tracer provider (same setup run-turn.test.ts uses),
// so this file's new span-nesting/real-filter assertions below can inspect
// actual ReadableSpan objects instead of guessing at withTurnSpan/
// startTraceRoot's behavior.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// HTTP-layer concerns (auth, parsing, status mapping, span nesting) are
// tested here. The actual KB-embed/Inngest-send logic is mocked wholesale —
// its own behavior is covered by tests/agent/tools/missing-info.test.ts.
// There's no more Supabase escalations lookup at this layer — the dynamic
// segment is the correlation id itself, not a DB row id.
const handleMissingInfoReplyReceivedMock = vi.fn();
vi.mock("@/agent/tools/missing-info.js", () => ({
  handleMissingInfoReplyReceived: handleMissingInfoReplyReceivedMock,
}));

// This route's own best-effort pending_owner_decisions bookkeeping — mocked
// at this module boundary, same style as handleMissingInfoReplyReceived
// above. Its own success/failure behavior (never throwing) is covered by
// pending-owner-decisions.ts's own unit coverage; this file only asserts
// this route calls it with the right args, after the real work above has
// already succeeded.
const markPendingOwnerDecisionRelayedMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  markPendingOwnerDecisionRelayed: markPendingOwnerDecisionRelayedMock,
}));

// consumeMissingInfoTraceAnchor is this route's one real Supabase-backed
// call (see tracing.ts) — mocked the same "mock the module's exported
// external-call function directly" way run-turn.test.ts mocks updateSpanIO.
//
// withTurnSpan/startTraceRoot are wrapped as spies over their REAL
// implementations (mockImplementation set below, once the real module is
// available) rather than mocked away — they still do real span/attribute
// work, so spanExporter-based assertions on this span's own attributes stay
// meaningful. They're wrapped only so this suite can assert which of the two
// the route actually chose (real parent-child linkage itself can't be
// verified here: it depends on a real AsyncLocalStorage-based
// ContextManager, which only instrumentation.ts registers for the real
// Next.js runtime — this test harness, like run-turn.test.ts's, only
// registers a TracerProvider, so context.with()'s default NoopContextManager
// silently ignores the parent context passed to it. withTurnSpan being
// called with the right anchor is the strongest same-harness proof of
// correct threading available).
const withTurnSpanSpy = vi.fn();
const startTraceRootSpy = vi.fn();
const consumeMissingInfoTraceAnchorMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  withTurnSpanSpy.mockImplementation(actual.withTurnSpan);
  startTraceRootSpy.mockImplementation(actual.startTraceRoot);
  return {
    ...actual,
    consumeMissingInfoTraceAnchor: consumeMissingInfoTraceAnchorMock,
    withTurnSpan: withTurnSpanSpy,
    startTraceRoot: startTraceRootSpy,
  };
});

const { POST } = await import("@/app/api/owner-nudges/[correlationId]/answer/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/owner-nudges/corr-abc-123/answer", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(correlationId: string) {
  return { params: Promise.resolve({ correlationId }) };
}

describe("POST /api/owner-nudges/[correlationId]/answer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    handleMissingInfoReplyReceivedMock.mockReset();
    handleMissingInfoReplyReceivedMock.mockResolvedValue({
      documentId: 42,
      embeddingDimensions: 1536,
    });
    consumeMissingInfoTraceAnchorMock.mockReset();
    // Default: no anchor found — same as before this route ever tried to
    // look one up, exercising the disconnected-trace-root fallback path.
    consumeMissingInfoTraceAnchorMock.mockResolvedValue(null);
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
      makeRequest({ answer: "The AC is above the bed" }, "wrong-key"),
      makeParams("corr-abc-123"),
    );
    expect(res.status).toBe(401);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("corr-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing answer in request body" });
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is whitespace-only", async () => {
    const res = await POST(makeRequest({ answer: "   " }), makeParams("corr-abc-123"));
    expect(res.status).toBe(400);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("delegates to handleMissingInfoReplyReceived with the correlation id from the path and returns ok: true", async () => {
    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("corr-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(handleMissingInfoReplyReceivedMock).toHaveBeenCalledWith({
      correlationId: "corr-abc-123",
      answer: "The AC is above the bed",
    });
    // Best-effort pending_owner_decisions bookkeeping, called after the real
    // KB-embed/Inngest-send work above already succeeded, with the owner's
    // actual answer captured as context.
    expect(markPendingOwnerDecisionRelayedMock).toHaveBeenCalledWith("corr-abc-123", {
      answer: "The AC is above the bed",
    });
  });

  it("does not call markPendingOwnerDecisionRelayed when handleMissingInfoReplyReceived throws", async () => {
    handleMissingInfoReplyReceivedMock.mockRejectedValueOnce(new Error("insert boom"));

    await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("corr-abc-123"));

    expect(markPendingOwnerDecisionRelayedMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message when handleMissingInfoReplyReceived throws", async () => {
    handleMissingInfoReplyReceivedMock.mockRejectedValueOnce(new Error("insert boom"));

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("corr-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
  });

  // Covers the actual trace-anchor threading this route now does: when
  // consumeMissingInfoTraceAnchor finds a real anchor (run-turn.ts's
  // runMissingInfo wrote one for this correlationId), the embedding step's
  // span must nest as a real child of it — not start its own disconnected
  // trace root — and carry real input/output attributes.
  describe("gen_ai.embed.missing_info_answer span", () => {
    function findSpan(name: string): ReadableSpan {
      const span = spanExporter.getFinishedSpans().find((s) => s.name === name);
      if (!span) {
        throw new Error(`no finished span named "${name}"`);
      }
      return span;
    }

    it("nests under the real hitlAnchor when consumeMissingInfoTraceAnchor finds one", async () => {
      const hitlAnchor = { traceId: "1".repeat(32), spanId: "1".repeat(16) };
      consumeMissingInfoTraceAnchorMock.mockResolvedValueOnce(hitlAnchor);

      await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("corr-abc-123"));

      // withTurnSpan (real nesting), not startTraceRoot (disconnected root),
      // called with exactly the anchor consumeMissingInfoTraceAnchor
      // returned — see this describe block's own comment for why this is
      // the strongest same-harness proof of correct threading available.
      expect(withTurnSpanSpy).toHaveBeenCalledWith(
        hitlAnchor,
        "gen_ai.embed.missing_info_answer",
        expect.any(Object),
        expect.any(Function),
      );
      expect(startTraceRootSpy).not.toHaveBeenCalled();

      const span = findSpan("gen_ai.embed.missing_info_answer");
      expect(span.attributes["gca.tool.input"]).toBe("The AC is above the bed");
      expect(span.attributes["braintrust.input"]).toBe("The AC is above the bed");
      expect(span.attributes["gca.tool.output"]).toBe(
        JSON.stringify({ documentId: 42, embeddingDimensions: 1536 }),
      );
      expect(span.attributes["braintrust.output"]).toBe(span.attributes["gca.tool.output"]);
    });

    it("falls back to its own disconnected trace root when no anchor is found", async () => {
      // beforeEach already defaults consumeMissingInfoTraceAnchor to null.
      await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("corr-abc-123"));

      expect(startTraceRootSpy).toHaveBeenCalledWith(
        "gen_ai.embed.missing_info_answer",
        expect.any(Object),
        expect.any(Function),
      );
      expect(withTurnSpanSpy).not.toHaveBeenCalled();

      const span = findSpan("gen_ai.embed.missing_info_answer");
      expect(span.attributes["gca.correlation_id"]).toBe("corr-abc-123");
    });

    // Confirmed against the real, installed @braintrust/otel package (same
    // BraintrustSpanProcessor/_spanProcessor/filterAISpans setup run-turn.
    // test.ts's own real-filter block uses), not assumed — this span's name
    // already starts with "gen_ai." (one of @braintrust/otel's own
    // FILTER_PREFIXES), so it should clear the real export filter on that
    // alone, whether nested under a real toolAnchor or not.
    it("passes the real @braintrust/otel export filter", async () => {
      const captured: ReadableSpan[] = [];
      const capturingProcessor: SpanProcessor = {
        onStart: () => {},
        onEnd: (span) => {
          captured.push(span);
        },
        shutdown: async () => {},
        forceFlush: async () => {},
      };
      const braintrustProcessor = new BraintrustSpanProcessor({
        _spanProcessor: capturingProcessor,
        filterAISpans: true,
      });

      await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("corr-abc-123"));

      braintrustProcessor.onEnd(findSpan("gen_ai.embed.missing_info_answer"));

      expect(captured).toHaveLength(1);
    });
  });
});
