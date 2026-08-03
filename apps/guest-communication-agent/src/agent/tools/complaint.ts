import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./config";
import { performEscalation } from "./escalation-shared";

const complaintSchema = z.object({
  reason: z
    .string()
    .describe(
      "Brief description of the guest's complaint/issue — a short paraphrase is enough, this is shown to the owner as context.",
    ),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runComplaint below by name (tool name "complaint", matching this literal
// key in run-turn.ts's `tools` ToolSet).
//
// No HITL gating on this tool (unlike wants_human/sendBookingLink) and no
// other behavior change from the old escalateToOwner's complaint branch —
// the app owner is still deciding how complaint handling should ultimately
// work, so this is a deliberate, unchanged carry-over pending that design.
export const complaint = tool({
  description:
    "Alert the owner about a guest complaint. Use when the guest is expressing dissatisfaction or reporting a problem.",
  inputSchema: complaintSchema,
});

export async function runComplaint(args: z.infer<typeof complaintSchema>, context: ToolContext) {
  const { conversationId, phone, triggerMessageId } = context;
  await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "complaint",
    triggerMessageId,
  });
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
