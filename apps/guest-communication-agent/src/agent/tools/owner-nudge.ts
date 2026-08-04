import { DBOS } from "@dbos-inc/dbos-sdk";
import { EventType, emit } from "@/lib/events";
import { sendOwnerNudge } from "@/lib/telegram-router";

// Plain string union, not a zod schema — nothing parses untrusted input
// into it; each tool's identity (wants_human/missing_info) already
// encodes this.
export type OwnerNudgeReason = "wants_human" | "missing_info";

// No more escalations table — the app owner decided it overcomplicated
// things unnecessarily (see supabase/migrations/*_drop_escalations_table.sql
// for the removal and the full rationale). This just pushes a nudge through
// apps/telegram-router's POST /api/owner-nudges; telegram-router owns
// composing/sending the actual Telegram message for every category.
//
// missing_info's one genuinely load-bearing need — correlating a later
// owner reply back to the specific suspended DBOS workflow waiting on it —
// no longer goes through a DB row at all. workflowId (when supplied) rides
// along to telegram-router, which embeds it as a `[ref:<workflowId>]` tag at
// the end of the nudge text; the owner's reply then carries that same tag
// back via Telegram's own `reply_to_message.text`, and telegram-router's
// webhook route parses it straight out — no DB lookup, no GCA API call.
// wants_human never expects a reply, so it never passes workflowId.
//
// Returns whether the Telegram send itself succeeded — there's no more
// DB-generated id to hand back.
export async function requestOwnerNudge(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: OwnerNudgeReason;
  // Current runGuestTurn workflow id (DBOS.workflowID). Only missing_info
  // passes this — see the module comment above for what it's used for.
  workflowId?: string;
}): Promise<boolean> {
  const { conversationId, phone, reason, reasonCategory, workflowId } = params;

  const nudgeResult = await sendOwnerNudge({
    phone,
    reason,
    reasonCategory,
    conversationId,
    workflowId,
  });
  if (!nudgeResult.ok) {
    console.error("[owner-nudge] telegram-router nudge failed:", nudgeResult.error);
    return false;
  }

  await DBOS.runStep(
    () =>
      emit({
        type: EventType.OwnerNudgeRequested,
        workflowId: workflowId ?? "unknown",
        reason,
        reasonCategory,
      }),
    { name: "owner-nudge-requested" },
  );

  return true;
}
