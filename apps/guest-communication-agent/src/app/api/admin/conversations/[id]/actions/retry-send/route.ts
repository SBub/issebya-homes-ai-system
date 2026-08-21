import { type NextRequest, NextResponse } from "next/server";
import { getConversationById, getFailedDeliveryMessageById } from "@/lib/admin-conversations";
import { requireApiKey } from "@/lib/auth";
import { updateMessageDeliveryStatus } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

/**
 * Re-attempts delivery of one specific delivery_status='failed' assistant
 * message (failure class 1: a reply was generated but never delivered) via
 * the same sendWhatsAppMessage the real turn dispatcher uses, then updates
 * that row's delivery_status again based on the outcome.
 *
 * - 400 if the JSON body's `messageId` is missing or not a string.
 * - 404 if the conversation doesn't exist.
 * - 400 if `messageId` doesn't identify a currently-failed message on this
 *   conversation.
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
    const body = await request.json().catch(() => null);
    const messageId = (body as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId !== "string" || messageId.length === 0) {
      return NextResponse.json(
        { error: "messageId is required in the request body" },
        { status: 400 },
      );
    }

    const conversation = await getConversationById(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const failedMessage = await getFailedDeliveryMessageById(id, messageId);
    if (!failedMessage) {
      return NextResponse.json(
        { error: "No matching failed-delivery message found for this conversation" },
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
