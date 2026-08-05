import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GUEST_TURN_REQUESTED_EVENT } from "@/agent/run-turn";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { normalizePhone } from "@/lib/phone";
import { verifyTwilioSignature } from "@/lib/twilio";

/**
 * Receives inbound WhatsApp messages via Twilio's webhook format, validates
 * X-Twilio-Signature, then triggers the guest's turn as a durable Inngest
 * function WITHOUT awaiting it, and immediately acks with empty TwiML.
 *
 * A missing_info owner nudge can suspend the turn for minutes or hours
 * waiting on the owner's Telegram reply, which an HTTP request can't stay
 * open for — so every reply is delivered later, proactively, by the
 * function itself (run-turn.ts's sendWhatsAppMessage call). This route's
 * response is always just an ack.
 */
export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  if (!authToken || !webhookUrl) {
    console.error(
      "[guest-communication-agent] TWILIO_AUTH_TOKEN/TWILIO_WEBHOOK_URL not set — all webhook requests will be rejected",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  const signature = request.headers.get("X-Twilio-Signature");
  if (!signature || !verifyTwilioSignature(authToken, webhookUrl, params, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const incomingMessage = params.Body;
  if (!params.From || !incomingMessage) {
    return NextResponse.json({ error: "Missing From/Body" }, { status: 400 });
  }
  // Normalized once here, right at the ingress boundary — every downstream
  // consumer (conversations, the agent function itself) receives this
  // bare value and never has to know about Twilio's "whatsapp:" prefix.
  // Signature verification above operates on the raw `params` object and is
  // unaffected by this.
  const phone = normalizePhone(params.From);

  const { conversationId } = await getOrCreateActiveConversation(phone);
  const userMessageId = await recordMessage(conversationId, "user", incomingMessage);

  // Generated once, here — a plain Next.js request handler that runs exactly
  // once per real inbound webhook call, not a replayed Inngest step — then
  // threaded through the event's own data so the triggered run-guest-turn
  // function can read it back deterministically on every one of its own
  // replays (see run-turn.ts's GuestTurnRequestedEventData for the full
  // reasoning).
  const correlationId = crypto.randomUUID();

  // `await` here only awaits the event being durably accepted by Inngest,
  // not the triggered function's result — it runs/resumes independently of
  // this request.
  await inngest.send({
    name: GUEST_TURN_REQUESTED_EVENT,
    data: {
      conversationId,
      phone,
      incomingMessage,
      triggerMessageId: userMessageId,
      correlationId,
    },
  });

  // Empty <Response></Response> is valid TwiML that sends no message — the
  // real reply arrives later via the function's own proactive send.
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
