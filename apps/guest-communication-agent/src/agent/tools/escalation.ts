import { tool } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { sendEscalationNudge } from "@/lib/telegram-router";
import type { ToolContext } from "./config";

// Named separately so run-turn.ts's deterministic performEscalation call
// sites (which skip this tool's schema validation) can reuse the same type.
const escalationReasonCategorySchema = z.enum(["wants_human", "complaint", "missing_info"]);
export type EscalationReasonCategory = z.infer<typeof escalationReasonCategorySchema>;

// Inserts the escalations row and pushes a nudge through apps/telegram-router
// for all three categories. telegram_message_id is stored for all of them
// (not just missing_info) since it's the correlation id a reply needs — a
// wants_human reply can't be mistaken for an answer because it's already
// resolved by insert time; a complaint reply is guarded by reason_category in
// the webhook's handleEscalationReply. wants_human auto-resolves at insert
// time (no owner action to wait for). complaint does not auto-resolve —
// intentionally reverted per the owner, pending a real resolution mechanism.
//
// Exported so run-turn.ts's safety nets can trigger the same escalation path
// without duplicating this logic; the model itself only sees the
// escalateToOwner tool below.
export async function performEscalation(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: EscalationReasonCategory;
  // The guest's real original message id, distinct from `reason` (the
  // model's paraphrase). Optional: only the real webhook call path supplies
  // it; other callers leave trigger_message_id null rather than fabricating one.
  triggerMessageId?: string;
}): Promise<void> {
  const { conversationId, phone, reason, reasonCategory, triggerMessageId } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("escalations")
    .insert({
      conversation_id: conversationId,
      phone_number: phone,
      reason,
      reason_category: reasonCategory,
      ...(triggerMessageId ? { trigger_message_id: triggerMessageId } : {}),
      ...(reasonCategory === "wants_human" ? { resolved_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[escalations] insert failed, skipping owner nudge:", error?.message);
    return;
  }

  const nudgeResult = await sendEscalationNudge({
    escalationId: data.id,
    phone,
    reason,
    reasonCategory,
    conversationId,
  });
  if (!nudgeResult.ok) {
    console.error("[escalations] telegram-router nudge failed:", nudgeResult.error);
    return;
  }

  // telegramMessageId can be missing even on an ok result (e.g.
  // telegram-router isn't configured) — nothing to correlate a reply
  // against, so leave telegram_message_id null rather than writing a
  // meaningless value.
  if (nudgeResult.telegramMessageId != null) {
    await supabase
      .from("escalations")
      .update({ telegram_message_id: nudgeResult.telegramMessageId })
      .eq("id", data.id);
  }
}

const escalateToOwnerSchema = z.object({
  reason: z
    .string()
    .describe(
      "Brief description of why escalation is needed. For missing_info and complaint, a short paraphrase of the guest's question/issue is enough. For wants_human specifically, this text becomes the entire context an owner sees in the Telegram alert (shown as \"Guest {phone} needs you: {reason}\") — write more than the bare trigger phrase: summarize what's been discussed so far (topic, any relevant details the guest already shared, their name if known) and specifically why they're asking to speak with a person, so the owner can pick up the conversation without it reading blank.",
    ),
  reason_category: escalationReasonCategorySchema.describe(
    "Which kind of escalation this is — missing_info specifically means you couldn't find an answer to the guest's question in the property knowledge base (answerPropertyQuestion came back empty/insufficient); use wants_human/complaint for everything else.",
  ),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runEscalateToOwner below by name, passing this turn's ToolContext.
export const escalateToOwner = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest asks for a human, has a complaint, or asks something you cannot answer. Always classify which of those three this is via reason_category.",
  inputSchema: escalateToOwnerSchema,
});

export async function runEscalateToOwner(
  args: z.infer<typeof escalateToOwnerSchema>,
  context: ToolContext,
) {
  const { conversationId, phone, triggerMessageId } = context;
  await performEscalation({
    conversationId,
    phone,
    reason: args.reason,
    reasonCategory: args.reason_category,
    triggerMessageId,
  });
  return {
    escalated: true,
    message: "The owner has been notified and will be in touch shortly.",
  };
}
