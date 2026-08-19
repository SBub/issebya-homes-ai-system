import { context, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same in-memory OTel wiring as approval-gate.test.ts/sandbox.test.ts, so the
// assertions below can inspect real span events instead of a no-op tracer.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);
// Unlike the other test files, this one specifically exercises
// trace.getActiveSpan() being read from a *different* function than the one
// that started the span (tracing.ts's recordBestEffortFailure, called from
// inside recordMissingInfoTraceAnchor/updateSpanIO, reading back the span
// this test's startActiveSpan call made active). @opentelemetry/api's
// default context manager is a no-op that doesn't actually propagate
// context across awaits, so without registering a real one here, this would
// always read back as "no active span" — see instrumentation.ts's own
// AsyncHooksContextManager registration/comment for the production
// equivalent of this.
const contextManager = new AsyncHooksContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);
const testTracer = trace.getTracer("tracing.test.ts");

// recordMissingInfoTraceAnchor's one external boundary: supabase's
// .from("missing_info_trace_anchors").insert(...), same mocking shape as
// missing-info.test.ts.
const insertMock = vi.fn();
const mockFrom = vi.fn(() => ({ insert: insertMock }));
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

const { recordMissingInfoTraceAnchor, updateSpanIO } = await import("@/lib/tracing.js");

const TEST_ANCHOR = { traceId: "1".repeat(32), spanId: "1".repeat(16) };

describe("tracing.ts best-effort helpers — failure visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("recordMissingInfoTraceAnchor adds a tracing.best_effort_failed event on the active span when the DB write fails, without throwing", async () => {
    insertMock.mockResolvedValue({ error: { message: "insert failed: unique violation" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let finishedSpanId: string | undefined;
    await testTracer.startActiveSpan("test.parent", async (span) => {
      finishedSpanId = span.spanContext().spanId;
      await expect(recordMissingInfoTraceAnchor("corr-1", TEST_ANCHOR)).resolves.toBeUndefined();
      span.end();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();

    const parentSpan = spanExporter
      .getFinishedSpans()
      .find((s) => s.spanContext().spanId === finishedSpanId);
    expect(parentSpan).toBeDefined();
    const events = parentSpan?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("tracing.best_effort_failed");
    expect(events[0]?.attributes).toEqual({
      "tracing.helper": "recordMissingInfoTraceAnchor",
      "error.message": "insert failed: unique violation",
    });

    consoleErrorSpy.mockRestore();
  });

  it("recordMissingInfoTraceAnchor does not add an event (and does not throw) when there is no active span", async () => {
    insertMock.mockResolvedValue({ error: { message: "insert failed: unique violation" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordMissingInfoTraceAnchor("corr-no-span", TEST_ANCHOR),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    // No active span existed at the call site, so nothing should have been
    // exported with our event — just confirming this path stays a no-op
    // rather than throwing or fabricating a span.
    const eventfulSpans = spanExporter
      .getFinishedSpans()
      .filter((s) => s.events.some((e) => e.name === "tracing.best_effort_failed"));
    expect(eventfulSpans).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });

  it("updateSpanIO adds a tracing.best_effort_failed event on the active span when the Braintrust call throws, without throwing", async () => {
    vi.stubEnv("BRAINTRUST_API_KEY", "test-key");
    vi.stubEnv("BRAINTRUST_PROJECT_ID", "test-project");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let finishedSpanId: string | undefined;
    await testTracer.startActiveSpan("test.parent.updateSpanIO", async (span) => {
      finishedSpanId = span.spanContext().spanId;
      await expect(updateSpanIO("span-abc", { output: "hello" })).resolves.toBeUndefined();
      span.end();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();

    const parentSpan = spanExporter
      .getFinishedSpans()
      .find((s) => s.spanContext().spanId === finishedSpanId);
    expect(parentSpan).toBeDefined();
    const events = parentSpan?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("tracing.best_effort_failed");
    expect(events[0]?.attributes).toEqual({
      "tracing.helper": "updateSpanIO",
      "error.message": "network unreachable",
    });

    consoleErrorSpy.mockRestore();
  });
});
