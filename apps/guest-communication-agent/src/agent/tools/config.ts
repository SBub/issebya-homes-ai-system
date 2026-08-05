import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";

// Per-turn identifiers passed to the tools that need them (runSendBookingLink,
// runWantsHuman, runMissingInfo), via run-turn.ts's
// runToolCall().
export interface ToolContext {
  conversationId: string;
  phone: string;
  // Only the real webhook call path (via @/agent/run-turn.ts's
  // runGuestTurn) supplies this; other callers leave it undefined.
  triggerMessageId?: string;
  // This turn's Inngest step tools. run-turn.ts wraps each real tool call in
  // step.run() for durability, and missing_info additionally uses
  // step.waitForEvent to suspend/resume while waiting on the owner's reply.
  // Every real call site (runAgentTurn, always running inside
  // runGuestTurnFunction) supplies a real one; there's no ambient ("current
  // workflow") equivalent to fall back on the way DBOS had, so this must
  // always be threaded through explicitly.
  step: GetStepTools<typeof inngest>;
  // This turn's correlation id (see run-turn.ts's GuestTurnRequestedEventData).
  // Only missing_info actually forwards this to requestOwnerNudge — to
  // correlate a later owner reply back to this specific suspended run via
  // the `[ref:<correlationId>]` tag telegram-router embeds/parses;
  // wants_human never expects a reply, so it never passes it on. Optional at
  // the type level for hypothetical callers outside a live run.
  correlationId?: string;
}
