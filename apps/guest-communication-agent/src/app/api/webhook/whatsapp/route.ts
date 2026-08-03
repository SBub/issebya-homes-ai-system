import { DBOS } from "@dbos-inc/dbos-sdk";
import { type NextRequest, NextResponse } from "next/server";
import { runGuestTurnWorkflow } from "@/agent/run-guest-turn";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { registerGuestContact } from "@/lib/crm";
import { ensureDbosLaunched } from "@/lib/dbos";
import { verifyTwilioSignature } from "@/lib/twilio";

/**
 * Receives inbound WhatsApp messages via Twilio's webhook format, validates
 * X-Twilio-Signature, then starts the guest's turn as a durable DBOS
 * workflow (@/agent/run-guest-turn.ts's runGuestTurnWorkflow) WITHOUT
 * awaiting it, and immediately acks with empty TwiML.
 *
 * This route used to await runAgentTurn directly and reply synchronously
 * via TwiML built from its result. That no longer works now that a
 * missing_info escalation can genuinely suspend the turn (via DBOS.recv —
 * see @/agent/tools/missing-info.ts's waitForMissingInfoReply) for minutes,
 * hours, or longer, waiting on the owner's Telegram reply — an HTTP request
 * cannot stay open that long, and Twilio's webhook contract doesn't expect
 * it to. So instead: every reply (not just missing_info ones) is now
 * delivered later, proactively, by the workflow itself
 * (run-guest-turn.ts's runGuestTurn sends via
 * @/lib/twilio-send.ts's sendWhatsAppMessage once it has a final answer —
 * whether that's 200ms or, after a real suspend, much later). This route's
 * own HTTP response is always just an ack; it carries no guest-facing
 * content anymore.
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

  // Fire-and-forget: never blocks/fails the guest-facing turn.
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

  // Start the durable workflow WITHOUT awaiting its completion — mirrors
  // harness-engineering/server/index.ts's
  // `await DBOS.startWorkflow(workflow)(message.input)`. The `await` here
  // only awaits the workflow being durably started (enqueued), not its
  // result; run-guest-turn.ts's runGuestTurn resumes/finishes independently
  // of this HTTP request's lifetime.
  await ensureDbosLaunched();
  await DBOS.startWorkflow(runGuestTurnWorkflow)({
    conversationId,
    phone,
    incomingMessage,
    triggerMessageId: userMessageId,
  });

  // Empty <Response></Response> is valid TwiML that sends no message — the
  // guest hears nothing from this HTTP response; the real reply arrives
  // later via the workflow's own proactive sendWhatsAppMessage call (see
  // @/agent/run-guest-turn.ts).
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
