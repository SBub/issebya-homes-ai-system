import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCheckAvailability } from "@/agent/tools/availability.js";

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

const { buildScript, runInSandbox } = await import("@/agent/tools/sandbox.js");

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

// The script buildScript emits runs on a different machine, so nothing in the
// normal call path ever executes it here — the mangled-escape class of bug
// (\d collapsing to a bare "d" inside the untagged template literal) is
// invisible to prettier, lint and typecheck alike. These tests therefore
// evaluate the emitted checkAvailability shim and compare it against
// availability.ts's computeCheckAvailability, the thing it mirrors. Asserting
// the generated *text* instead would let the same bug back in.
describe("buildScript — generated checkAvailability shim", () => {
  const RESULT_SENTINEL = "__RUNCODE_RESULT__";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Date only: faking setTimeout/setInterval wholesale would stall
    // vi.waitFor below and the generated script's own async IIFE.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ bookings: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function runGeneratedCheckAvailability(args: {
    room: "room1" | "room2";
    checkIn: string;
    checkOut: string;
  }): Promise<unknown> {
    const script = await buildScript(
      `return await tools.checkAvailability(${JSON.stringify(args)});`,
      {
        // buildScript only reads this key's name to decide which shim to
        // emit; it never calls it (only getPricing is called). Throwing here
        // asserts the VM-side shim is what runs, not run-code.ts's closure.
        checkAvailability: () => {
          throw new Error("in-process closure must not run");
        },
      },
    );

    // The generated program is self-contained ("use strict", its own logs /
    // console / tools, one async IIFE) and reports through a single
    // sentinel-prefixed stdout line.
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      new Function(script)();
      await vi.waitFor(() => expect(writeSpy).toHaveBeenCalled());
      const line = writeSpy.mock.calls
        .map(([chunk]) => String(chunk))
        .find((chunk) => chunk.startsWith(RESULT_SENTINEL));
      expect(line).toBeDefined();
      const output = JSON.parse((line as string).slice(RESULT_SENTINEL.length));
      // Surface a thrown shim error as its message rather than as an
      // unreadable deep-equality diff.
      expect(output.ok, output.error).toBe(true);
      return output.result;
    } finally {
      writeSpy.mockRestore();
    }
  }

  it("fetches availability for a valid future range", async () => {
    const args = { room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-13" } as const;

    const result = await runGeneratedCheckAvailability(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/availability?room=room1");
    expect(result).toEqual({
      available: true,
      room: "room1",
      checkIn: "2026-10-11",
      checkOut: "2026-10-13",
    });
    expect(result).toEqual(await computeCheckAvailability(args));
  });

  it("refuses a past range without fetching", async () => {
    const args = { room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" } as const;

    const result = await runGeneratedCheckAvailability(args);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ available: false, reason: "past_date" });
    expect(result).toEqual(await computeCheckAvailability(args));
  });

  it("refuses a zero-night range", async () => {
    const args = { room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-11" } as const;

    const result = await runGeneratedCheckAvailability(args);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ available: false, reason: "invalid_range" });
    expect(result).toEqual(await computeCheckAvailability(args));
  });

  it("refuses a non-ISO date", async () => {
    const args = { room: "room1", checkIn: "11-10-2026", checkOut: "13-10-2026" } as const;

    const result = await runGeneratedCheckAvailability(args);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ available: false, reason: "invalid_date" });
    expect(result).toEqual(await computeCheckAvailability(args));
  });
});
