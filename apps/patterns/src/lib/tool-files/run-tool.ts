import { steppedSpan } from "@/lib/trace-anchor/anchored-request";
import { checkDates, runCheckDates } from "./check-dates";
import type { ToolContext } from "./context";
import { runLookupRate, lookupRate } from "./lookup-rate";
import { detectSoftFailure, dispatchToolExecution } from "./tool-execution";

/**
 * The registry handed to the model and the one dispatcher every call goes
 * through. Each tool's span lives in its own `run<Tool>`; this file wraps
 * nothing except the unknown-name fallback, which has no tool file to own
 * a span.
 */

export const tools = {
  check_dates: checkDates,
  lookup_rate: lookupRate,
};

async function dispatch(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "check_dates":
      return runCheckDates(input, context);
    case "lookup_rate":
      return runLookupRate(input, context);
    default:
      if (context.variant?.unknownTool === "throw") {
        // The wrong variant: the step fails, the turn has no reply, a retry repeats the same call.
        throw new Error(`Unknown tool "${toolName}"`);
      }
      // A model can invent a close-but-wrong name. An error the model can read beats a throw.
      return steppedSpan(
        context.step,
        context.tracer,
        `tool-${toolName}`,
        context.traceAnchor,
        (span) =>
          dispatchToolExecution(span, input, () => ({
            error: `Unknown tool name: "${toolName}". Valid tools are: ${Object.keys(tools).join(", ")}.`,
          })),
      );
  }
}

export async function runTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  const output = await dispatch(toolName, input, context);
  if (context.variant?.softFailure === "throw") {
    // The wrong variant: a soft failure the model could have recovered from ends the turn instead.
    const failure = detectSoftFailure(output);
    if (failure !== null) throw new Error(failure);
  }
  return output;
}
