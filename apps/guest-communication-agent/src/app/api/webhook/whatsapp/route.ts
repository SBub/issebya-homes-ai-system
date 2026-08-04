import { DBOS } from "@dbos-inc/dbos-sdk";
import { type NextRequest, NextResponse } from "next/server";
import { runGuestTurnWorkflow } from "@/agent/run-guest-turn";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { registerGuestContact } from "@/lib/crm";
import { ensureDbosLaunched } from "@/lib/dbos";
import { normalizePhone } from "@/lib/phone";
import { verifyTwilioSignature } from "@/lib/twilio";

/**
 * Receives inbound WhatsApp messages via Twilio's webhook format, validates
 * X-Twilio-Signature, then starts the guest's turn as a durable DBOS
 * workflow WITHOUT awaiting it, and immediately acks with empty TwiML.
 *
 * A missing_info escalation can suspend the turn for minutes or hours
 * waiting on the owner's Telegram reply, which an HTTP request can't stay
 * open for — so every reply is delivered later, proactively, by the
 * workflow itself (run-guest-turn.ts's sendWhatsAppMessage call). This
 * route's response is always just an ack.
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
  // consumer (conversations, CRM, the agent workflow itself) receives this
  // bare value and never has to know about Twilio's "whatsapp:" prefix.
  // Signature verification above operates on the raw `params` object and is
  // unaffected by this.
  const phone = normalizePhone(params.From);

  const { conversationId, isNew } = await getOrCreateActiveConversation(phone);
  const userMessageId = await recordMessage(conversationId, "user", incomingMessage);

  // Fire-and-forget: never blocks/fails the guest-facing turn.
  if (isNew) {
    const result = await registerGuestContact(phone);
    if (!result.ok) {
      console.warn(
        `[guest-communication-agent] registerGuestContact failed for ${phone}: ${result.error}`,
      );
    }
  }

  // `await` here only awaits the workflow being durably started (enqueued),
  // not its result — it resumes/finishes independently of this request.
  await ensureDbosLaunched();
  await DBOS.startWorkflow(runGuestTurnWorkflow)({
    conversationId,
    phone,
    incomingMessage,
    triggerMessageId: userMessageId,
  });

  // Empty <Response></Response> is valid TwiML that sends no message — the
  // real reply arrives later via the workflow's own proactive send.
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
