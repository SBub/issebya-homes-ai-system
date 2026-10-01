import { z } from "zod";
import { computeCheckDates, invalidInput } from "@/lib/tool-files/check-dates";
import type { ToolContext } from "@/lib/tool-files/context";
import { computeLookupRate } from "@/lib/tool-files/lookup-rate";
import { dispatchToolExecution } from "@/lib/tool-files/tool-execution";
import { steppedSpan } from "@/lib/trace-anchor/anchored-request";
import { runInSandbox, type SandboxApi } from "./sandbox";

/**
 * The `run_code` tool file, in the tool file convention: a schema the
 * model sees, the api object that is the allowlist of what a program may
 * call, and the traced run that hands the code to the engine. The compute
 * here is the engine; the tool owns no logic of its own.
 */

const runCodeSchema = z.object({ code: z.string().describe("An async function body") });

export const runCode = {
  description: [
    "Run a short JavaScript program (an async function body) instead of making many tool calls.",
    "Available inside the program:",
    "  await tools.checkDates({ from, to }) returns { ok: true, free } or { ok: false, reason, today }",
    "  await tools.lookupRate({ room }) returns { room, nightly, currency }",
    "  console.log(...) is captured and returned in logs",
    "Use return for the result. The program cannot send a link or change anything.",
  ].join("\n"),
  inputSchema: runCodeSchema,
};

/**
 * Read-only computes only. The engine throws for any key it has no shim
 * for, so a send could not be added here without writing a shim for it on
 * purpose. A link is a gated tool call, never reachable from a program.
 */
export const sandboxApi: SandboxApi = {
  lookupRate: computeLookupRate,
  checkDates: computeCheckDates,
};

export function runRunCode(input: Record<string, unknown>, context: ToolContext) {
  return steppedSpan(context.step, context.tracer, "tool-run_code", context.traceAnchor, (span) =>
    dispatchToolExecution(span, input, async () => {
      const parsed = runCodeSchema.safeParse(input);
      if (!parsed.success) return invalidInput("run_code", parsed.error);
      return await runInSandbox(parsed.data.code, sandboxApi, { today: context.today });
    }),
  );
}
