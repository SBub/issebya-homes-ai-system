import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/agent/tools/config";
import type { inngest } from "@/lib/inngest";

// Same in-memory OTel wiring as sandbox.test.ts/owner-nudge.test.ts, so the
// assertions below can inspect the real "db.matchDocuments" span
// property-question.ts emits, instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// The two true external boundaries: the match_documents RPC (Postgres) and
// the embedding call (OpenRouter). Everything else, including the tool's
// own span plumbing, runs for real.
const rpcMock = vi.fn();
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(() => ({ rpc: rpcMock })),
}));

const embedMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, embed: embedMock };
});

vi.mock("@/lib/openrouter.js", () => ({
  openrouter: { embedding: (modelId: string) => modelId },
}));

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

const { runAnswerPropertyQuestion } = await import("@/agent/tools/property-question.js");

type StepTools = GetStepTools<typeof inngest>;

const FALLBACK_TEXT = "No relevant information found in the knowledge base.";

function makeContext(): ToolContext {
  const step = {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
    waitForEvent: vi.fn(),
  } as unknown as StepTools;
  return {
    conversationId: "convo-1",
    phone: "+351920742845",
    traceAnchor: { traceId: "0".repeat(32), spanId: "0".repeat(16) },
    step,
  } as ToolContext;
}

function findMatchDocumentsSpan() {
  return spanExporter.getFinishedSpans().find((span) => span.name === "db.matchDocuments");
}

describe("runAnswerPropertyQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
  });

  it("joins matched documents and records match_count/top_similarity on the db span", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { id: 1, content: "Check-in is from 15:00.", similarity: 0.82 },
        { id: 2, content: "Late check-in is possible on request.", similarity: 0.61 },
      ],
      error: null,
    });

    const result = await runAnswerPropertyQuestion({ query: "check-in time" }, makeContext());

    expect(result).toBe("Check-in is from 15:00.\n\nLate check-in is possible on request.");
    expect(rpcMock).toHaveBeenCalledWith(
      "match_documents",
      expect.objectContaining({ match_count: 5, match_threshold: 0.3, filter: {} }),
    );

    const dbSpan = findMatchDocumentsSpan();
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(dbSpan?.attributes["db.match_count"]).toBe(2);
    expect(dbSpan?.attributes["db.top_similarity"]).toBe(0.82);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns the fallback text on a genuine no-match without reporting an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAnswerPropertyQuestion({ query: "helipad" }, makeContext());

    expect(result).toBe(FALLBACK_TEXT);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();

    const dbSpan = findMatchDocumentsSpan();
    expect(dbSpan?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(dbSpan?.attributes["db.match_count"]).toBe(0);
    expect(dbSpan?.attributes["db.error_code"]).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });

  it("returns the same fallback text on an RPC error, but logs it, reports it to Sentry and marks the db span failed", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table documents",
        details: "",
        hint: "GRANT SELECT ON public.documents TO anon",
      },
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAnswerPropertyQuestion({ query: "check-in time" }, makeContext());

    // The model-facing string must stay identical to a real miss: the system
    // prompt routes on this exact phrasing.
    expect(result).toBe(FALLBACK_TEXT);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[answer_property_question] match_documents RPC failed:",
      { code: "42501", message: "permission denied for table documents" },
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [captured, captureContext] = captureExceptionMock.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe(
      "match_documents failed (42501): permission denied for table documents",
    );
    expect(captureContext).toEqual({
      tags: { tool: "answer_property_question", "db.error_code": "42501" },
    });

    const dbSpan = findMatchDocumentsSpan();
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(dbSpan?.attributes["db.error_code"]).toBe("42501");
    expect(dbSpan?.attributes["db.match_count"]).toBeUndefined();

    consoleErrorSpy.mockRestore();
  });
});
