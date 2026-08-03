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

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runWantsHuman below by name (tool name "wants_human", matching this
// literal key in run-turn.ts's `tools` ToolSet). Also one of run-turn.ts's
// NEEDS_HITL-gated tools — see that file's requestHitlApproval stub, which
// runs before this tool is ever dispatched.
export const wantsHuman = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest explicitly asks to speak with a human/person. For a complaint use the complaint tool instead, and for a question you cannot answer use missing_info instead.",
  inputSchema: wantsHumanSchema,
});

export async function runWantsHuman(args: z.infer<typeof wantsHumanSchema>, context: ToolContext) {
  const { conversationId, phone, triggerMessageId } = context;
  await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: "wants_human",
    triggerMessageId,
  });
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
