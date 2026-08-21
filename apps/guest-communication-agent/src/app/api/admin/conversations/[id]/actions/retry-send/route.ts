import { type NextRequest, NextResponse } from "next/server";
import { getConversationById, getLastFailedDeliveryMessage } from "@/lib/admin-conversations";
import { requireApiKey } from "@/lib/auth";
import { updateMessageDeliveryStatus } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

/**
 * Re-attempts delivery of a conversation's most recent
 * delivery_status='failed' assistant message (failure class 1: a reply was
 * generated but never delivered) via the same sendWhatsAppMessage the real
 * turn dispatcher uses, then updates that row's delivery_status again based
 * on the outcome.
 *
 * - 404 if the conversation doesn't exist.
 * - 400 if there's no failed-delivery message to retry.
 * - Otherwise 200 with `{ ok, messageId, deliveryStatus, error? }` —
 *   `ok: false` here means the retry itself was attempted but Twilio's send
 *   failed again (a real, expected outcome for a still-broken number, not a
 *   500-worthy server error).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;

  try {
    const conversation = await getConversationById(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const failedMessage = await getLastFailedDeliveryMessage(id);
    if (!failedMessage) {
      return NextResponse.json(
        { error: "No failed-delivery message to retry for this conversation" },
        { status: 400 },
      );
    }

    const sendResult = await sendWhatsAppMessage(conversation.phone, failedMessage.content);
    const deliveryStatus = sendResult.ok ? "sent" : "failed";
    await updateMessageDeliveryStatus(failedMessage.id, deliveryStatus);

    return NextResponse.json({
      ok: sendResult.ok,
      messageId: failedMessage.id,
      deliveryStatus,
      ...(sendResult.ok ? {} : { error: sendResult.error }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
