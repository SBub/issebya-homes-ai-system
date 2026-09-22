import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { steppedSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";

const getCurrentDateSchema = z.object({});

export const getCurrentDate = tool({
  description:
    "Get today's actual real-world date. Call this BEFORE resolving any relative date or day reference the guest mentions (e.g. 'tomorrow', 'next weekend', 'this Friday', 'in two weeks') or before checking availability for a relative date — do not guess or infer today's date from training data, always call this tool first and do the date arithmetic from its result.",
  inputSchema: getCurrentDateSchema,
});

// Also called directly by run-code.ts's sandboxApi as an internal helper.
export function computeCurrentDate() {
  // No property/host timezone concept exists anywhere in this codebase —
  // deliberately uses UTC rather than guessing one. Real limitation: near
  // midnight, UTC's "today" can differ from the property's local "today".
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  return {
    date: isoDate,
    dayOfWeek,
    isoTimestamp: now.toISOString(),
    timezone: "UTC",
  };
}

export async function runGetCurrentDate(context: ToolContext) {
  return steppedSpan(
    context.step,
    "tool-get_current_date",
    context.traceAnchor,
    "gen_ai.tool.get_current_date",
    { "gen_ai.tool.name": "get_current_date", "gen_ai.operation.name": "execute_tool" },
    (span) => dispatchToolExecution(span, {}, async () => computeCurrentDate()),
  );
}
