import { describe, expect, it } from "vitest";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import { createStepRunner } from "@/lib/harness/step-runner";
import { runCode, runRunCode, sandboxApi } from "../run-code";
import {
  assertSupported,
  buildScript,
  parseSandboxOutput,
  RESULT_SENTINEL,
  runInSandbox,
  runScript,
  type SandboxApi,
  SUPPORTED_TOOLS,
} from "../sandbox";
import type { ScriptRun } from "../types";

const TODAY = "2026-10-01";

describe("the allowlist", () => {
  it("accepts the shimmed tools and refuses any other key before anything runs", async () => {
    expect(runCode).not.toHaveProperty("execute");
    expect(Object.keys(sandboxApi)).toEqual([...SUPPORTED_TOOLS]);
    expect(() => assertSupported(sandboxApi)).not.toThrow();
    const withSend: SandboxApi = { ...sandboxApi, sendLink: () => ({ sent: true }) };
    expect(() => assertSupported(withSend)).toThrow(/no shim for tool\(s\): sendLink/);
    await expect(runInSandbox("return 1;", withSend, { today: TODAY })).rejects.toThrow(/sendLink/);
  });

  it("generates a shim only for the keys requested, with no send anywhere", () => {
    const script = buildScript("return 1;", { lookupRate: sandboxApi.lookupRate }, TODAY);
    expect(script).toContain("async lookupRate(");
    expect(script).not.toContain("checkDates");
    expect(script).not.toContain("sendLink");
    expect(script).toContain('"small":{"room":"small","nightly":95');
  });
});

describe("runScript", () => {
  it("separates the result line from the logs on stdout and stops", async () => {
    const run = await runScript(
      buildScript('console.log("one");\nconsole.log("two");\nreturn 42;', {}, TODAY),
      500,
    );
    expect(run.error).toBeNull();
    expect(run.stopped).toBe(true);
    const lines = run.stdout.trimEnd().split("\n");
    expect(lines.slice(0, 2)).toEqual(["one", "two"]);
    expect(lines[2].startsWith(RESULT_SENTINEL)).toBe(true);
    expect(parseSandboxOutput(run.stdout)).toEqual({
      ok: true,
      result: 42,
      logs: ["one", "two"],
      calls: [],
    });
    expect(() => JSON.parse(run.stdout)).toThrow();
  });

  it("times out a program that awaits forever", async () => {
    const run = await runScript(buildScript("await new Promise(() => {});", {}, TODAY), 100);
    expect(run.error).toBe("timed out after 100 ms");
    expect(run.stopped).toBe(true);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(90);
  });

  it("times out a synchronous loop through the VM's own timeout", async () => {
    const run = await runScript(buildScript("while (true) {}", {}, TODAY), 100);
    expect(run.error).toMatch(/timed out/i);
    expect(run.stopped).toBe(true);
  });

  it("reports a syntax error instead of hanging", async () => {
    const run = await runScript(buildScript("return (;", {}, TODAY), 100);
    expect(run.error).toMatch(/Unexpected token/);
  });
});

describe("parseSandboxOutput", () => {
  it("reads the last sentinel line and ignores the rest", () => {
    const stdout = `noise\n${RESULT_SENTINEL}{"ok":true,"result":1,"logs":[],"calls":[]}\nmore noise\n`;
    expect(parseSandboxOutput(stdout)).toEqual({ ok: true, result: 1, logs: [], calls: [] });
    expect(parseSandboxOutput("just noise\n")).toBeNull();
    expect(parseSandboxOutput(`${RESULT_SENTINEL}{not json`)).toBeNull();
  });
});

describe("runInSandbox", () => {
  it("runs a program over the shims and records every shim call", async () => {
    const code = `const check = await tools.checkDates({ from: "2026-10-13", to: "2026-10-15" });
const rate = await tools.lookupRate({ room: "large" });
console.log("free:", check.free);
return { free: check.free, nightly: rate.nightly };`;
    const result = await runInSandbox(code, sandboxApi, { today: TODAY });
    expect(result).toEqual({
      ok: true,
      result: { free: true, nightly: 140 },
      logs: ["free: true"],
      calls: [
        { tool: "checkDates", args: { from: "2026-10-13", to: "2026-10-15" } },
        { tool: "lookupRate", args: { room: "large" } },
      ],
    });
  });

  it("mirrors the guard: a past range is refused as a value with today", async () => {
    const result = await runInSandbox(
      'return await tools.checkDates({ from: "2026-09-20", to: "2026-09-22" });',
      sandboxApi,
      { today: TODAY },
    );
    expect(result).toMatchObject({
      ok: true,
      result: { ok: false, reason: "past_date", today: TODAY },
    });
  });

  it("returns a throw inside the program as ok false with the logs kept", async () => {
    const result = await runInSandbox(
      'console.log("before");\nawait tools.lookupRate({ room: "penthouse" });',
      sandboxApi,
      { today: TODAY },
    );
    expect(result).toEqual({
      ok: false,
      error: 'lookupRate: unknown room "penthouse"',
      logs: ["before"],
      calls: [{ tool: "lookupRate", args: { room: "penthouse" } }],
    });
  });

  it("returns the timeout as ok false and hands the raw run to the hook", async () => {
    const seen: ScriptRun[] = [];
    const result = await runInSandbox("await new Promise(() => {});", sandboxApi, {
      today: TODAY,
      timeoutMs: 100,
      onScriptRun: (run) => {
        seen.push(run);
      },
    });
    expect(result).toEqual({ ok: false, error: "timed out after 100 ms", logs: [], calls: [] });
    expect(seen[0]?.stopped).toBe(true);
  });
});

describe("runRunCode", () => {
  it("is a tool file: parse, engine, span", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    const { anchor } = await tracer.startRoot("tool.call", () => undefined);
    const run = createStepRunner<unknown>(
      ({ step }) =>
        runRunCode(
          { code: 'return (await tools.lookupRate({ room: "small" })).nightly;' },
          { step, tracer, traceAnchor: anchor, today: TODAY },
        ),
      { trigger: { name: "tool.call", data: {} } },
    );
    await run.start();
    expect(run.getSnapshot().result).toMatchObject({ ok: true, result: 95 });
    const span = exporter.getSnapshot().pending.find((entry) => entry.name === "tool-run_code");
    expect(span?.status).toBe("unset");

    const bad = createStepRunner<unknown>(
      ({ step }) => runRunCode({ code: 42 }, { step, tracer, traceAnchor: anchor, today: TODAY }),
      { trigger: { name: "tool.call", data: {} } },
    );
    await bad.start();
    expect(bad.getSnapshot().result).toMatchObject({
      error: expect.stringContaining("Invalid input for run_code"),
    });
  });
});
