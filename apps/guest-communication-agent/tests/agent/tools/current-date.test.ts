import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// Same in-memory OTel wiring as wants-human.test.ts, so runGetCurrentDate's
// own span assertion below inspects a real span's attributes instead of a
// no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

const { computeCurrentDate, runGetCurrentDate } = await import("@/agent/tools/current-date.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

type StepTools = GetStepTools<typeof inngest>;

function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
  } as unknown as StepTools & { run: ReturnType<typeof vi.fn> };
}

// computeCurrentDate has no external dependencies (no DB, no fetch, no
// step) — it just wraps `new Date()` — so the only thing worth pinning down
// with fake timers is that its output tracks the real clock correctly and
// stays in UTC, matching the "no timezone concept in this codebase" note in
// current-date.ts.
describe("computeCurrentDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's date, day of week, and a full ISO timestamp, all in UTC", () => {
    // Wednesday, matches a fixed instant so the assertion isn't relative.
    vi.setSystemTime(new Date("2026-08-05T10:30:00.000Z"));

    const result = computeCurrentDate();

    expect(result).toEqual({
      date: "2026-08-05",
      dayOfWeek: "Wednesday",
      isoTimestamp: "2026-08-05T10:30:00.000Z",
      timezone: "UTC",
    });
  });

  it("resolves the UTC calendar date even when local time would land on a different day", () => {
    // Just after midnight UTC — a naive local-timezone read (e.g. UTC-5)
    // would still say the previous day. Confirms this stays UTC-only.
    vi.setSystemTime(new Date("2026-08-05T00:15:00.000Z"));

    const result = computeCurrentDate();

    expect(result.date).toBe("2026-08-05");
    expect(result.dayOfWeek).toBe("Wednesday");
  });
});

// runGetCurrentDate is the tool's real dispatch — wraps computeCurrentDate in
// its own gen_ai.tool.get_current_date execution span (this app's
// run<ToolName> convention).
describe("runGetCurrentDate", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T10:30:00.000Z"));
    step = makeStepMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns computeCurrentDate's result", async () => {
    const result = await runGetCurrentDate({
      conversationId: "convo-1",
      phone: "+3519",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(result).toEqual({
      date: "2026-08-05",
      dayOfWeek: "Wednesday",
      isoTimestamp: "2026-08-05T10:30:00.000Z",
      timezone: "UTC",
    });
  });

  it("creates a gen_ai.tool.get_current_date execution span with the real output attached", async () => {
    await runGetCurrentDate({
      conversationId: "convo-1",
      phone: "+3519",
      traceAnchor: TEST_TRACE_ANCHOR,
      step,
    });

    expect(step.run.mock.calls.map((call) => call[0])).toContain("tool-get_current_date");

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.get_current_date");
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("get_current_date");
    expect(execSpan?.attributes["gca.tool.input"]).toBe(JSON.stringify({}));
    expect(execSpan?.attributes["gca.tool.output"]).toBe(
      JSON.stringify({
        date: "2026-08-05",
        dayOfWeek: "Wednesday",
        isoTimestamp: "2026-08-05T10:30:00.000Z",
        timezone: "UTC",
      }),
    );
  });
});
