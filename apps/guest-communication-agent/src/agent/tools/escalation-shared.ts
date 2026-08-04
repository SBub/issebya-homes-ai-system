import { createAdminClient } from "@/lib/supabase";
import { sendEscalationNudge } from "@/lib/telegram-router";

// Plain string union, not a zod schema — nothing parses untrusted input
// into it; each tool's identity (wants_human/missing_info) already
// encodes this.
export type EscalationReasonCategory = "wants_human" | "missing_info";

// Inserts the escalations row and pushes a nudge through apps/telegram-router
// for all three categories. wants_human is auto-resolved at insert time (no
// owner action to wait for); missing_info has its own real DBOS suspend/resume.
//
// Returns the new escalations row's id (missing-info.ts's DBOS.recv wait
// keys off it), or null if the insert failed.
export async function performEscalation(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: EscalationReasonCategory;
  // The guest's real original message id, distinct from `reason` (the
  // model's paraphrase).
  triggerMessageId?: string;
  // Current runGuestTurn workflow id (DBOS.workflowID), so
  // POST /api/escalations/[id]/resolve can DBOS.send to it later. Only
  // missing_info needs this.
  workflowId?: string;
}): Promise<string | null> {
  const { conversationId, phone, reason, reasonCategory, triggerMessageId, workflowId } = params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("escalations")
    .insert({
      conversation_id: conversationId,
      phone_number: phone,
      reason,
      reason_category: reasonCategory,
      ...(triggerMessageId ? { trigger_message_id: triggerMessageId } : {}),
      ...(workflowId ? { workflow_id: workflowId } : {}),
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
