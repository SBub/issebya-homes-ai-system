import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import type { TraceAnchor } from "@/lib/tracing";

// Per-turn identifiers passed to every tool's run<ToolName>.
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Parented to "braintrust.guest_turn" — a tool's own spans nest under it.
  // Stable across an Inngest replay even after a long step.waitForEvent
  // suspend.
  traceAnchor: TraceAnchor;
  // Only set on the real webhook call path.
  triggerMessageId?: string;
  // Inngest has no ambient "current workflow" to read from, so this must
  // always be threaded through explicitly.
  step: GetStepTools<typeof inngest>;
  // Only missing_info forwards this to requestOwnerNudge, to correlate a
  // later owner reply back to this suspended run via telegram-router's
  // `[ref:<correlationId>]` tag. Optional for hypothetical callers outside a
  // live run.
  correlationId?: string;
}
