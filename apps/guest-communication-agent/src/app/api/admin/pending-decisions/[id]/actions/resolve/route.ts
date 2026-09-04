import { type NextRequest, NextResponse } from "next/server";
import { computeSendBookingLink } from "@/agent/tools/booking";
import { requireApiKey } from "@/lib/auth";
import { recordMessage, updateMessageDeliveryStatus } from "@/lib/conversations";
import {
  getPendingOwnerDecisionById,
  markPendingOwnerDecisionResolvedById,
} from "@/lib/pending-owner-decisions";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

// send_booking_link's context is written at insert time by
// approval-gate.ts's requestApprovalGate (booking.ts's
// requestSendBookingLinkApproval passes the model's own tool-call args
// straight through) — the exact same shape sendBookingLinkSchema declares
// (see booking.ts).
interface BookingContext {
  guestName?: string;
  email?: string;
  room?: "room1" | "room2";
  checkIn?: string;
  checkOut?: string;
}

// missing_info's context is written later, by the owner-nudges answer route
// (markPendingOwnerDecisionRelayed's `context` param), once the owner's real
// answer is known — never present at insert time.
interface MissingInfoContext {
  answer?: string;
}

/**
 * Manual fix for a stuck pending_owner_decisions row — failure class 3
 * (the owner's decision/answer was relayed but the suspended run that
 * should have consumed it is dead). Rebuilds whatever that dead run would
 * have sent the guest and sends it directly, bypassing Inngest entirely.
 *
 * Branches on tool_name:
 * - send_booking_link: rebuilds the same deterministic booking URL
 *   computeSendBookingLink would have produced, from the row's own `context`
 *   (guestName/email/room/checkIn/checkOut, captured at insert time — see
 *   BookingContext above).
 * - missing_info: sends a short plain-text message containing the owner's
 *   actual answer, from the row's own `context.answer` (captured once the
 *   owner-nudges answer route received it — see MissingInfoContext above).
 *   No model call — the owner's own words are used as-is.
 *
 * Either branch, on a real send success: records the sent text as an
 * assistant whatsapp_messages row with delivery_status "sent" (skipped if
 * conversation_id is null — a whatsapp_conversations cascade-delete already
 * cleared it, see the migration's own ON DELETE SET NULL comment) and marks
 * the row resolved with resolution: "manually_resolved", distinct from the
 * resolutions a live run can reach on its own (answered/approved/rejected/
 * timeout) so it's unambiguous in any later audit that an operator
 * intervened here.
 *
 * - 404 if no row exists for this id.
 * - 409 if the row is already resolved (idempotent-safe: a second resolve
 *   attempt is rejected rather than double-sending).
 * - 400 if the row's tool_name-specific context needed to act is missing
 *   (an unexpected state for a real row, but not something to 500 over).
 * - 502 if the WhatsApp send itself fails — the row is left unresolved so
 *   this action can be retried.
 * - Otherwise 200 with `{ ok: true, resolution: "manually_resolved", sentMessage }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  try {
    const decision = await getPendingOwnerDecisionById(id);
    if (!decision) {
      return NextResponse.json({ error: "Pending owner decision not found" }, { status: 404 });
    }
    if (decision.resolvedAt !== null) {
      return NextResponse.json(
        { error: `Already resolved (resolution: ${decision.resolution ?? "unknown"})` },
        { status: 409 },
      );
    }

    let messageText: string;
    if (decision.toolName === "send_booking_link") {
      const context = (decision.context as BookingContext | null) ?? {};
      if (!context.room || !context.checkIn || !context.checkOut) {
        return NextResponse.json(
          {
            error:
              "Missing room/checkIn/checkOut in this row's context — cannot rebuild the booking link",
          },
          { status: 400 },
        );
      }
      const { url } = computeSendBookingLink(
        {
          guestName: context.guestName ?? "Guest",
          email: context.email ?? "unknown@example.com",
          room: context.room,
          checkIn: context.checkIn,
          checkOut: context.checkOut,
        },
        decision.phone,
      );
      messageText = url;
    } else {
      const answer = (decision.context as MissingInfoContext | null)?.answer;
      if (!answer) {
        return NextResponse.json(
          { error: "No answer captured on this row yet — nothing to send" },
          { status: 400 },
        );
      }
      messageText = `Following up on your earlier question: ${answer}`;
    }

    const sendResult = await sendWhatsAppMessage(decision.phone, messageText);
    if (!sendResult.ok) {
      return NextResponse.json(
        { error: sendResult.error ?? "sendWhatsAppMessage failed with no error message" },
        { status: 502 },
      );
    }

    if (decision.conversationId) {
      // Same two-step recordMessage-then-updateMessageDeliveryStatus
      // sequence run-guest-turn.ts's sendGuestWhatsAppReply uses — sendResult.ok
      // is already confirmed true here (the !sendResult.ok branch above
      // already returned), so this always writes "sent", never "failed".
      const messageId = await recordMessage(decision.conversationId, "assistant", messageText);
      await updateMessageDeliveryStatus(messageId, "sent");
    }

    await markPendingOwnerDecisionResolvedById(id, "manually_resolved");

    return NextResponse.json({
      ok: true,
      resolution: "manually_resolved",
      sentMessage: messageText,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
