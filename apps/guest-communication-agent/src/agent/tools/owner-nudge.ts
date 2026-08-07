import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import { sendOwnerNudge } from "@/lib/telegram-router";
import { markSpanFailed, withSpan } from "@/lib/tracing";

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
// owner reply back to the specific suspended run-guest-turn Inngest function
// waiting on it — no longer goes through a DB row at all. correlationId
// (when supplied) rides along to telegram-router, which embeds it as a
// `[ref:<correlationId>]` tag at the end of the nudge text; the owner's
// reply then carries that same tag back via Telegram's own
// `reply_to_message.text`, and telegram-router's webhook route parses it
// straight out — no DB lookup, no GCA API call. wants_human never expects a
// reply, so it never passes correlationId.
//
// Returns whether the Telegram send itself succeeded — there's no more
// DB-generated id to hand back.
export async function requestOwnerNudge(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: OwnerNudgeReason;
  // Current run's correlation id. Only missing_info passes this — see the
  // module comment above for what it's used for.
  correlationId?: string;
  // This turn's Inngest step tools. Kept required here since every real
  // caller already threads one through ToolContext; this function itself no
  // longer does anything with it.
  step: GetStepTools<typeof inngest>;
}): Promise<boolean> {
  const { conversationId, phone, reason, reasonCategory, correlationId } = params;

  // Generic withSpan, not withTurnSpan: this `correlationId` param is
  // requestOwnerNudge's own business-logic value (only missing_info ever
  // sets it — see the doc comment above), not necessarily the turn's real
  // correlation id (wants_human never passes one on here, even though its
  // own ToolContext.correlationId is real). Using it as a deterministic
  // trace key would give every wants_human call (which all resolve
  // correlationId to undefined here) the SAME shared trace id. Callers
  // (missing-info.ts, wants-human.ts) already wrap their own step.run
  // callback in withTurnSpan(context.correlationId, ...) before calling this
  // — that's the real, per-turn trace key. This span just needs to nest
  // under it via ambient context, which withSpan does automatically.
  return withSpan(
    "owner_nudge.request",
    {
      "gca.phone": phone,
      "gca.conversation_id": conversationId,
      "gca.reason_category": reasonCategory,
    },
    async (span) => {
      const nudgeResult = await sendOwnerNudge({
        phone,
        reason,
        reasonCategory,
        conversationId,
        correlationId,
      });
      if (!nudgeResult.ok) {
        console.error("[owner-nudge] telegram-router nudge failed:", nudgeResult.error);
        markSpanFailed(
          span,
          nudgeResult.error ?? "telegram-router nudge failed with no error message",
        );
        return false;
      }

      return true;
    },
  );
}
