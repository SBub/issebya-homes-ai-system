import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same in-memory OTel wiring as approval-gate.test.ts/run-turn.test.ts, so
// the assertions below can inspect the real "sandbox.stop" span sandbox.ts's
// runInSandbox emits, instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// runInSandbox's one true external boundary — mocked the same way
// run-turn.test.ts mocks it, so these tests can drive both a clean stop()
// and a failing stop() without any real Vercel Sandbox provisioning.
const sandboxCreateMock = vi.fn();
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: (...args: unknown[]) => sandboxCreateMock(...args) },
}));

const { runInSandbox } = await import("@/agent/tools/sandbox.js");

function makeFakeSandbox(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    writeFiles: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: vi.fn().mockResolvedValue('__RUNCODE_RESULT__{"ok":true,"result":1,"logs":[]}'),
      stderr: vi.fn().mockResolvedValue(""),
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runInSandbox — sandbox.stop teardown span", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
  });

  it("emits a sandbox.stop span with no error status when teardown succeeds", async () => {
    const fakeSandbox = makeFakeSandbox();
    sandboxCreateMock.mockResolvedValue(fakeSandbox);

    const result = await runInSandbox("return 1;", {});

    expect(result).toEqual({ ok: true, result: 1, logs: [] });
    expect(fakeSandbox.stop).toHaveBeenCalledTimes(1);

    const stopSpan = spanExporter.getFinishedSpans().find((span) => span.name === "sandbox.stop");
    expect(stopSpan).toBeDefined();
    expect(stopSpan?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("marks the sandbox.stop span failed (without throwing or changing the result) when teardown fails", async () => {
    const fakeSandbox = makeFakeSandbox({
      stop: vi.fn().mockRejectedValue(new Error("stop unavailable in test")),
    });
    sandboxCreateMock.mockResolvedValue(fakeSandbox);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runInSandbox("return 1;", {});

    // The guest's real run_code result must be unaffected by a teardown
    // failure — this stays fire-and-forget from the caller's perspective.
    expect(result).toEqual({ ok: true, result: 1, logs: [] });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[sandbox] failed to stop sandbox after runCode:",
      expect.any(Error),
    );

    const stopSpan = spanExporter.getFinishedSpans().find((span) => span.name === "sandbox.stop");
    expect(stopSpan).toBeDefined();
    expect(stopSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(stopSpan?.status.message).toBe("stop unavailable in test");

    consoleErrorSpy.mockRestore();
  });
});
