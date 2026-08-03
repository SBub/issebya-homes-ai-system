import { tool } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { sendEscalationNudge } from "@/lib/telegram-router";
import type { ToolContext } from "./config";

// Kept as its own named schema (rather than inlined into escalateToOwner's
// schema below) so the same enum/type can be reused by run-turn.ts's own
// deterministic performEscalation call sites (step-cap and empty-reply
// safety nets), which never go through this tool's schema validation.
const escalationReasonCategorySchema = z.enum(["wants_human", "complaint", "missing_info"]);
export type EscalationReasonCategory = z.infer<typeof escalationReasonCategorySchema>;

// All three categories insert the escalations row, select its id back, and
// push a nudge through apps/telegram-router (sendEscalationNudge) — unified
// so every category follows this repo's "one app owns all Telegram I/O"
// pattern.
//
// missing_info is the one category with a human-in-the-loop resolution
// path: the owner can reply to the nudge with the actual answer, which then
// reaches the guest and gets embedded into the property knowledge base (see
// POST /api/escalations/by-telegram-message-id/[id] and
// POST /api/escalations/[id]/resolve). That round trip needs a real
// correlation id (Telegram's reply_to_message.message_id), which only
// exists once the nudge has been sent — hence storing telegram_message_id
// below for every category, not just missing_info. A reply to a
// wants_human nudge can't be mistaken for an answer because it's already
// resolved by insert time (see below); a reply to a complaint nudge is
// guarded explicitly by reason_category in the webhook's
// handleEscalationReply.
//
// wants_human is auto-resolved at insert time (resolved_at set below) —
// there's no owner action to wait for; the system prompt already handles
// the guest-facing acknowledgment. The nudge is still sent so the owner
// knows, but nothing downstream waits on a reply. `answer` stays null since
// there's no owner-contributed text to store.
//
// complaint was briefly auto-resolved the same way, then reverted per the
// owner: "it shouldn't be resolved automatically for now, I don't yet know
// how to resolve this." So it goes back to being inserted with resolved_at
// unset, like missing_info — but for a different reason: missing_info
// awaits a real answer via the HITL flow above, while complaint awaits a
// resolution mechanism that hasn't been decided yet.
//
// Exported so run-turn.ts's step-cap/empty-reply safety nets can trigger
// the exact same escalation (including the nudge round trip) without
// duplicating this logic. The model itself only ever sees the
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

// A factory rather than a single module-level instance (unlike
// pricing.ts/availability.ts/property-question.ts) because this tool needs
// conversationId/phone/triggerMessageId to attribute the escalation to the
// right guest/conversation — run-turn.ts's buildAgentTools calls this fresh
// every turn, closing over that turn's context instead of threading it
// through per-call config the way LangChain's RunnableConfig.configurable
// used to.
export function createEscalateToOwnerTool(context: ToolContext) {
  const { conversationId, phone, triggerMessageId } = context;

  return tool({
    description:
      "Alert the owner and hand off the conversation. Use when the guest asks for a human, has a complaint, or asks something you cannot answer. Always classify which of those three this is via reason_category.",
    inputSchema: z.object({
      reason: z
        .string()
        .describe(
          "Brief description of why escalation is needed. For missing_info and complaint, a short paraphrase of the guest's question/issue is enough. For wants_human specifically, this text becomes the entire context an owner sees in the Telegram alert (shown as \"Guest {phone} needs you: {reason}\") — write more than the bare trigger phrase: summarize what's been discussed so far (topic, any relevant details the guest already shared, their name if known) and specifically why they're asking to speak with a person, so the owner can pick up the conversation without it reading blank.",
        ),
      reason_category: escalationReasonCategorySchema.describe(
        "Which kind of escalation this is — missing_info specifically means you couldn't find an answer to the guest's question in the property knowledge base (answerPropertyQuestion came back empty/insufficient); use wants_human/complaint for everything else.",
      ),
    }),
    execute: async ({ reason, reason_category }) => {
      await performEscalation({
        conversationId,
        phone,
        reason,
        reasonCategory: reason_category,
        triggerMessageId,
      });
      return {
        escalated: true,
        message: "The owner has been notified and will be in touch shortly.",
      };
    },
  });
}
