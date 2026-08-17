import { tool } from "ai";
import { z } from "zod";

const wantsHumanSchema = z.object({
  reason: z
    .string()
    .describe(
      "This text becomes the entire context an owner sees in the Telegram alert (shown as \"Guest {phone} needs you: {reason}\") — write more than the bare trigger phrase: summarize what's been discussed so far (topic, any relevant details the guest already shared, their name if known) and specifically why they're asking to speak with a person, so the owner can pick up the conversation without it reading blank.",
    ),
});

// Schema-only declaration — dispatched by run-turn.ts's runToolCall. A
// one-way alert with no decision to approve, so it has no entry in
// run-turn.ts's APPROVAL_GATES table and dispatches directly, the same as
// getPricing/checkAvailability.
export const wantsHuman = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest explicitly asks to speak with a human/person, or when they've made a request only the owner can act on or approve (e.g. early check-in, a special accommodation) that you can't resolve yourself.",
  inputSchema: wantsHumanSchema,
});

// Pure — no step/span/Inngest of any kind (see run-turn.ts's "tool files
// stay pure" rule near `tools`). The real work (sending the owner nudge,
// stepped/spanned for replay-safety) now lives in run-turn.ts's private
// dispatchWantsHuman, called from the SELF_STEPPED_TOOLS branch; this
// function is left with only the tool's own result shape, which never
// depends on the input args — kept as a real function (not inlined at the
// call site) for consistency with the rest of this app's run<ToolName>
// dispatch pattern (see current-date.ts's runGetCurrentDate for the same
// zero-arg shape).
export function runWantsHuman() {
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
