import type { Span } from "@opentelemetry/api";
import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import { sendOwnerNudge } from "@/lib/telegram-router";
import { markSpanFailed, withSpan } from "@/lib/tracing";

// Plain string union, not a zod schema — nothing parses untrusted input
// into it; each tool's identity (wants_human/missing_info/send_booking_link)
// already encodes this.
export type OwnerNudgeReason = "wants_human" | "missing_info" | "send_booking_link";

// Narrower exception per AGENTS.md's span tiers: this is shared plumbing
// CALLED BY tool-dispatch code (wants-human.ts's runWantsHuman,
// missing-info.ts's runMissingInfo, and approval-gate.ts's
// requestApprovalGate), not one tool's own business logic, structurally
// the same role as approval-gate.ts itself, not a dispatched tool. Its
// withSpan is a plain OTel span, zero step/Inngest coupling, same shape
// as property-question.ts's db.matchDocuments exception. Kept here
// rather than folded into each call site so the three callers share one
// implementation instead of duplicating the span wrap.
//
// No escalations table — this just pushes a nudge through
// apps/telegram-router's POST /api/owner-nudges; telegram-router owns
// composing/sending the actual Telegram message for every category.
//
// missing_info's one genuinely load-bearing need — correlating a later
// owner reply back to the specific suspended run-guest-turn Inngest function
// waiting on it — happens without a DB row. correlationId (when supplied)
// rides along to telegram-router, which embeds it as a
// `[ref:<correlationId>]` tag at the end of the nudge text; the owner's
// reply then carries that same tag back via Telegram's own
// `reply_to_message.text`, and telegram-router's webhook route parses it
// straight out — no DB lookup, no GCA API call. wants_human never expects a
// reply, so it never passes correlationId.
//
// send_booking_link also passes correlationId, but for a different transport:
// telegram-router sends its nudge WITH inline approve/reject buttons whose
// callback_data carries the correlationId directly (not the `[ref:...]` text
// tag), since a button tap is more reliable than parsing free text. See
// booking.ts and telegram-router's owner-nudges route/webhook route.
//
// Returns whether the Telegram send itself succeeded — there's no
// DB-generated id to hand back.
export async function requestOwnerNudge(params: {
  conversationId: string;
  phone: string;
  reason: string;
  reasonCategory: OwnerNudgeReason;
  // Current run's correlation id. missing_info and send_booking_link both
  // pass this — see the module comment above for what each uses it for.
  correlationId?: string;
  // This turn's Inngest step tools. Kept required here since every real
  // caller already threads one through ToolContext, even though this
  // function itself doesn't use it.
  step: GetStepTools<typeof inngest>;
}): Promise<boolean> {
  const { conversationId, phone, reason, reasonCategory, correlationId } = params;

  async function sendTelegramOwnerNudge(span: Span): Promise<boolean> {
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
  }

  // Generic withSpan, not withTurnSpan: this `correlationId` param is
  // requestOwnerNudge's own business-logic value (missing_info and
  // send_booking_link both set it — see the doc comment above), not
  // necessarily the turn's real correlation id (wants_human never passes one
  // on here, even though its own ToolContext.correlationId is real). Using
  // it as a deterministic trace key would give every wants_human call (which
  // all resolve correlationId to undefined here) the SAME shared trace id.
  // Callers (missing-info.ts, wants-human.ts, booking.ts) already wrap their
  // own step.run callback in withTurnSpan(context.correlationId, ...) before
  // calling this — that's the real, per-turn trace key. This span just needs
  // to nest under it via ambient context, which withSpan does automatically.
  return withSpan(
    "owner_nudge.request",
    {
      "gca.phone": phone,
      "gca.conversation_id": conversationId,
      "gca.reason_category": reasonCategory,
      // Also what gets this span past @braintrust/otel's export filter at
      // all (see tracing.ts's attribute-namespace comment block) — without
      // it, a real Telegram-send failure here (markSpanFailed above) never
      // reaches Braintrust, only server logs. Mirrors approval-gate.ts's
      // sendGatedOwnerNudge, which tags its own nudge span the same way.
      "braintrust.tags": [reasonCategory],
    },
    sendTelegramOwnerNudge,
  );
}
