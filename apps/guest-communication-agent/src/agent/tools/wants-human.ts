import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./config";
import { performEscalation } from "./escalation-shared";

const wantsHumanSchema = z.object({
  reason: z
    .string()
    .describe(
      "This text becomes the entire context an owner sees in the Telegram alert (shown as \"Guest {phone} needs you: {reason}\") — write more than the bare trigger phrase: summarize what's been discussed so far (topic, any relevant details the guest already shared, their name if known) and specifically why they're asking to speak with a person, so the owner can pick up the conversation without it reading blank.",
    ),
});

// Schema-only declaration — dispatched by run-turn.ts's runToolCall.
// Also NEEDS_HITL-gated there via requestHitlApproval before dispatch.
export const wantsHuman = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest explicitly asks to speak with a human/person.",
  inputSchema: wantsHumanSchema,
});

export async function runWantsHuman(args: z.infer<typeof wantsHumanSchema>, context: ToolContext) {
  const { conversationId, phone } = context;
  await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "wants_human",
  });
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
