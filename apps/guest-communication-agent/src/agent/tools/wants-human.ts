import { tool } from "ai";
import { z } from "zod";
import { withTurnSpan } from "@/lib/tracing";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

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
  const { conversationId, phone, step, traceAnchor } = context;
  // Wrapped in its own step.run — wants_human is dispatched directly from
  // run-turn.ts's loop (see SELF_STEPPED_TOOLS there), never nested inside an
  // outer step.run. Without this, a replay of this Inngest function (e.g. a
  // retry of a later step in the same run, like record-reply or
  // send-whatsapp-reply) would re-execute this real Telegram send every
  // time, since un-stepped code isn't memoized across replays.
  await step.run("owner-nudge-wants-human", () =>
    withTurnSpan(
      traceAnchor,
      "owner_nudge.wants_human",
      { "gca.conversation_id": conversationId, "gca.phone": phone },
      () =>
        requestOwnerNudge({
          conversationId,
          phone,
          reason: args.reason,
          reasonCategory: "wants_human",
          step,
        }),
    ),
  );
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
