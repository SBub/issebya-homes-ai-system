import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { sendWhatsAppMessage } from "@/lib/twilio-send";

/**
 * Proactive outbound send. Guarded by requireApiKey rather than Twilio's
 * signature (unlike the webhook route) — see @/lib/auth.ts.
 *
 * Request body: `{ phone: string, message: string }`.
 *
 * Reuses getOrCreateActiveConversation so a proactive send lands in the
 * guest's existing active conversation. recordMessage is deliberately
 * skipped on a Twilio failure (502) — an undelivered message shouldn't be
 * recorded as sent.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const phone = body?.phone;
  const message = body?.message;
  if (!phone || typeof phone !== "string" || !message || typeof message !== "string") {
    return NextResponse.json({ error: "Missing phone/message in request body" }, { status: 400 });
  }

  const { conversationId } = await getOrCreateActiveConversation(phone);

  const result = await sendWhatsAppMessage(phone, message);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  await recordMessage(conversationId, "assistant", message);

  return NextResponse.json({ ok: true });
}
