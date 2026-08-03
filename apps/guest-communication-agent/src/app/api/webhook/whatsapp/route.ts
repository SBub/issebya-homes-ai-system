import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { runAgentTurn } from "@/agent/run-turn";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { registerGuestContact, touchGuestContact } from "@/lib/crm";
import { deriveStageHint } from "@/lib/funnel-stage";
import { verifyTwilioSignature } from "@/lib/twilio";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Receives inbound WhatsApp messages via Twilio's webhook format, validates
 * X-Twilio-Signature, runs GCA's agent turn, and replies synchronously via
 * TwiML.
 *
 * When `result.missingInfoEscalated` is true, the interim reply is neither
 * sent to the guest nor recorded into whatsapp_messages. Recording it was
 * tried first, but a test showed it broke the later re-invocation (see
 * @/lib/resume-conversation.ts): the model would read the recorded "I've let
 * the owner know" line as already having handled the question and escalate
 * again instead of finding the freshly-embedded answer. Skipping the record
 * entirely avoids that trap.
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

  const phone = params.From;
  const incomingMessage = params.Body;
  if (!phone || !incomingMessage) {
    return NextResponse.json({ error: "Missing From/Body" }, { status: 400 });
  }

  const { conversationId, isNew } = await getOrCreateActiveConversation(phone);
  const userMessageId = await recordMessage(conversationId, "user", incomingMessage);

  // Fire-and-forget: never blocks/fails the guest-facing reply.
  // registerGuestContact() itself never throws; a console.warn is the only
  // signal on failure since this route replies via TwiML, not JSON.
  if (isNew) {
    const result = await registerGuestContact(phone);
    if (!result.ok) {
      console.warn(
        `[guest-communication-agent] registerGuestContact failed for ${phone}: ${result.error}`,
      );
    }
  }

  // Stored as whatsapp_messages.langsmith_run_id for eval-feedback
  // correlation, but is NOT a real LangSmith trace id — nothing on
  // LangSmith's side matches it, so a later feedback submission against it
  // will fail. Known regression, not addressed here.
  const runId = crypto.randomUUID();

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    // Lets a mid-turn escalation store this message as trigger_message_id,
    // so a later missing_info resolution can re-invoke runAgentTurn with the
    // guest's real original question rather than the model's paraphrase —
    // see @/lib/resume-conversation.ts.
    { triggerMessageId: userMessageId },
  );

  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Sorry, I couldn't process that — please try again shortly.";

  // Skipped entirely (not just undelivered) for a missing_info escalation —
  // see this file's header comment.
  if (!result.missingInfoEscalated) {
    await recordMessage(conversationId, "assistant", replyText, runId);
  }

  // Fire-and-forget, same as registerGuestContact above. CRM owns the
  // forward-only funnel_stage upgrade logic; this route just derives the
  // hint (see funnel-stage.ts).
  const stageHint = deriveStageHint(result.messages);
  const touchResult = await touchGuestContact(phone, stageHint);
  if (!touchResult.ok) {
    console.warn(
      `[guest-communication-agent] touchGuestContact failed for ${phone}: ${touchResult.error}`,
    );
  }

  // Empty <Response></Response> is valid TwiML that sends no message — the
  // guest hears nothing until the owner answers and
  // @/lib/resume-conversation.ts sends the real answer.
  const twiml = result.missingInfoEscalated
    ? "<Response></Response>"
    : `<Response><Message>${escapeXml(replyText)}</Message></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
