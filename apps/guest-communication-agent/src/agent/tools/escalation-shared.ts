import { createAdminClient } from "@/lib/supabase";
import { sendEscalationNudge } from "@/lib/telegram-router";

// Used to still be a single zod enum shared across one escalateToOwner
// tool's `reason_category` argument. That tool has since been split into
// three separate tools — wants_human, complaint, missing_info (see
// wants-human.ts/complaint.ts/missing-info.ts) — whose identity now encodes
// what this value used to. Kept as a plain string union (not a zod schema)
// since nothing parses untrusted input into it anymore; it only types this
// file's own performEscalation and telegram-router.ts's sendEscalationNudge.
export type EscalationReasonCategory = "wants_human" | "complaint" | "missing_info";

// Inserts the escalations row and pushes a nudge through apps/telegram-router
// for all three categories. telegram_message_id is stored for all of them
// (not just missing_info) since it's the correlation id a reply needs — a
// wants_human reply can't be mistaken for an answer because it's already
// resolved by insert time; a complaint reply is guarded by reason_category in
// the webhook's handleEscalationReply. wants_human auto-resolves at insert
// time (no owner action to wait for). complaint does not auto-resolve —
// intentionally reverted per the owner, pending a real resolution mechanism.
//
// Exported so wants-human.ts/complaint.ts/missing-info.ts's run<ToolName>
// implementations can all share this one insert-and-nudge path; the model
// itself never sees this function directly, only the three tool schemas.
//
// Returns the new escalations row's id (so missing-info.ts's stub HITL wait
// step has something to key off of), or null if the insert itself failed
// (already logged below) and there is nothing to nudge or wait on.
export async function performEscalation(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: EscalationReasonCategory;
  // The guest's real original message id, distinct from `reason` (the
  // model's paraphrase). Optional: only the real webhook call path supplies
  // it; other callers leave trigger_message_id null rather than fabricating one.
  triggerMessageId?: string;
}): Promise<string | null> {
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
    return null;
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
    return data.id;
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

  return data.id;
}
