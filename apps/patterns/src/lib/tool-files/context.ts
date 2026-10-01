import type { TraceAnchor, Tracer } from "@/lib/harness/span-exporter";
import type { StepTools } from "@/lib/harness/step-runner";

/**
 * What every tool's `run<Tool>` gets besides its own arguments: the step
 * tools and the trace anchor it opens its span under, and the date the
 * demos fix so a result is the same on every run. The `variant` field
 * exists only so the demo can show the two wrong shapes.
 */
export type ToolContext = {
  step: StepTools;
  tracer: Tracer;
  traceAnchor: TraceAnchor;
  today: string;
  variant?: {
    /** `"throw"` is the wrong variant: a soft failure ends the turn instead of reaching the model. */
    softFailure?: "return" | "throw";
    /** `"throw"` is the wrong variant: a name no tool has crashes the step. */
    unknownTool?: "error" | "throw";
  };
};
