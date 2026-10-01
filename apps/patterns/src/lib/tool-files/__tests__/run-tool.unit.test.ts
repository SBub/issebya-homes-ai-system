import { describe, expect, it } from "vitest";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import { createStepRunner } from "@/lib/harness/step-runner";
import { computeCheckDates } from "../check-dates";
import type { ToolContext } from "../context";
import { computeLookupRate } from "../lookup-rate";
import { runTool, tools } from "../run-tool";
import { detectSoftFailure } from "../tool-execution";

const TODAY = "2026-10-01";

/** Runs one tool call inside a durable run, as the loop does, and returns what came out. */
async function call(
  toolName: string,
  input: Record<string, unknown>,
  variant?: ToolContext["variant"],
) {
  const exporter = createBatchExporter();
  const tracer = createTracer(exporter);
  const { anchor } = await tracer.startRoot("tool.call", () => undefined);
  const run = createStepRunner<unknown>(
    ({ step }) =>
      runTool(toolName, input, { step, tracer, traceAnchor: anchor, today: TODAY, variant }),
    { trigger: { name: "tool.call", data: { toolName } } },
  );
  await run.start();
  const snapshot = run.getSnapshot();
  const span = exporter.getSnapshot().pending.find((entry) => entry.name.startsWith("tool-"));
  return { status: snapshot.status, output: snapshot.result, error: snapshot.error, span };
}

describe("compute functions are pure", () => {
  it("check_dates answers from its arguments alone", () => {
    expect(computeCheckDates({ from: "2026-10-06", to: "2026-10-08" }, TODAY)).toEqual({
      ok: true,
      free: true,
      from: "2026-10-06",
      to: "2026-10-08",
    });
    expect(computeCheckDates({ from: "2026-10-10", to: "2026-10-11" }, TODAY)).toMatchObject({
      ok: true,
      free: false,
    });
    expect(computeCheckDates({ from: "2026-09-20", to: "2026-09-22" }, TODAY)).toEqual({
      ok: false,
      reason: "past_date",
      today: TODAY,
    });
    expect(computeCheckDates({ from: "2026-10-08", to: "2026-10-06" }, TODAY)).toMatchObject({
      ok: false,
      reason: "invalid_range",
    });
  });

  it("lookup_rate answers from its arguments alone", () => {
    expect(computeLookupRate({ room: "small" })).toEqual({
      room: "small",
      nightly: 95,
      currency: "EUR",
    });
  });
});

describe("the registry", () => {
  it("holds schemas and descriptions and nothing that runs", () => {
    for (const tool of Object.values(tools)) {
      expect(tool).not.toHaveProperty("execute");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
    }
  });
});

describe("detectSoftFailure", () => {
  it("sees ok:false and the single-key error object, nothing else", () => {
    expect(detectSoftFailure({ ok: false, reason: "past_date" })).toBe("past_date");
    expect(detectSoftFailure({ ok: false })).toBe("tool call failed");
    expect(detectSoftFailure({ error: "Unknown tool" })).toBe("Unknown tool");
    expect(detectSoftFailure({ error: "x", reason: "y" })).toBeNull();
    expect(detectSoftFailure({ ok: true, free: true })).toBeNull();
    expect(detectSoftFailure("text")).toBeNull();
    expect(detectSoftFailure(null)).toBeNull();
  });
});

describe("runTool", () => {
  it("runs a tool in its own stepped span and records input and output", async () => {
    const result = await call("check_dates", { from: "2026-10-06", to: "2026-10-08" });
    expect(result.status).toBe("done");
    expect(result.output).toEqual({ ok: true, free: true, from: "2026-10-06", to: "2026-10-08" });
    expect(result.span?.name).toBe("tool-check_dates");
    expect(result.span?.status).toBe("unset");
    expect(result.span?.attributes["tool.output"]).toContain('"free":true');
  });

  it("returns a soft failure and marks the span failed without throwing", async () => {
    const result = await call("check_dates", { from: "2026-09-20", to: "2026-09-22" });
    expect(result.status).toBe("done");
    expect(result.output).toEqual({ ok: false, reason: "past_date", today: TODAY });
    expect(result.span?.status).toBe("error");
    expect(result.span?.error).toBe("past_date");
  });

  it("turns input the schema rejects into the single-key error object", async () => {
    const result = await call("lookup_rate", { room: "penthouse" });
    expect(result.status).toBe("done");
    expect(result.output).toMatchObject({
      error: expect.stringContaining("Invalid input for lookup_rate"),
    });
    expect(Object.keys(result.output as object)).toEqual(["error"]);
    expect(result.span?.status).toBe("error");
  });

  it("returns an error object for an unknown tool name, in a span of its own", async () => {
    const result = await call("book_dates", { from: "2026-10-06" });
    expect(result.status).toBe("done");
    expect(result.output).toEqual({
      error: 'Unknown tool name: "book_dates". Valid tools are: check_dates, lookup_rate.',
    });
    expect(result.span?.name).toBe("tool-book_dates");
    expect(result.span?.status).toBe("error");
  });

  it("the wrong variants end the run instead of giving the model a result", async () => {
    const thrown = await call("book_dates", {}, { unknownTool: "throw" });
    expect(thrown.status).toBe("failed");
    expect(thrown.error).toBe('Unknown tool "book_dates"');
    expect(thrown.span).toBeUndefined();

    const soft = await call(
      "check_dates",
      { from: "2026-09-20", to: "2026-09-22" },
      { softFailure: "throw" },
    );
    expect(soft.status).toBe("failed");
    expect(soft.error).toBe("past_date");
  });
});
