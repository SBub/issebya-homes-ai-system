import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GUEST_TURN_REQUESTED_EVENT } from "@/agent/run-turn";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { inngest } from "@/lib/inngest";
import { normalizePhone } from "@/lib/phone";
import { startTraceRoot, withTurnSpan } from "@/lib/tracing";
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
 *
 * "webhook.turn" below is a genuine trace root (src/lib/tracing.ts's
 * startTraceRoot) — a plain Next.js request handler runs exactly once per
 * real inbound webhook call, not a replayed Inngest step, so it's safe to
 * start a real, unparented span here. It's a near-zero-duration marker, not
 * a stage of its own — deliberately not named "webhook.verify_signature" or
 * any other real stage's name, since using a stage's own span as the anchor
 * would nest every later webhook.* stage AND the entire guest turn *inside*
 * that one stage's span (e.g. reading as one long "verify_signature" span
 * holding everything, when it's supposed to be a narrow signature check).
 * Every later stage in this request, AND every span run-turn.ts's triggered
 * function emits, parents to this marker's real {traceId, spanId} (its
 * "anchor") instead of a synthetic stand-in — the anchor rides along in the
 * enqueued event's own data (see run-turn.ts's GuestTurnRequestedEventData)
 * so the function can read it back on every one of its own Inngest replays.
 * A trace that has "webhook.record_inbound_message" but no
 * "webhook.enqueue_inngest" is, by construction, a turn that died before
 * ever reaching Inngest.
 *
 * Note on duration: this root's own span only covers the synchronous
 * portion of the request (through enqueueing the Inngest event) — it can't
 * honestly span the whole turn's wall-clock time the way a request/response
 * span normally would, since the turn continues asynchronously afterward
 * and missing_info can suspend it for up to 24h. "How long did this turn
 * actually take end-to-end" is a derived question (max(_time+duration) -
 * min(_time) across the trace), not one span's duration field.
 */
export async function POST(request: NextRequest) {
  // Correlates a later owner reply back to this exact suspended run (see
  // missing-info.ts) — unrelated to tracing (the trace anchor below covers
  // that job); kept as its own id because it means something different: an
  // Inngest waitForEvent key, not a span parent.
  const correlationId = crypto.randomUUID();

  try {
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

    const { anchor } = await startTraceRoot("webhook.turn", {}, async () => {});

    const signatureValid = await withTurnSpan(
      anchor,
      "webhook.verify_signature",
      {},
      async () => !!signature && verifyTwilioSignature(authToken, webhookUrl, params, signature),
    );
    if (!signatureValid) {
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

    const { conversationId, isNew } = await withTurnSpan(
      anchor,
      "webhook.get_or_create_conversation",
      { "gca.phone": phone },
      () => getOrCreateActiveConversation(phone),
    );

    const userMessageId = await withTurnSpan(
      anchor,
      "webhook.record_inbound_message",
      {
        "gca.phone": phone,
        "gca.conversation_id": conversationId,
        "gca.is_new_conversation": isNew,
      },
      () => recordMessage(conversationId, "user", incomingMessage),
    );

    // `await` here only awaits the event being durably accepted by Inngest,
    // not the triggered function's result — it runs/resumes independently of
    // this request.
    await withTurnSpan(
      anchor,
      "webhook.enqueue_inngest",
      { "gca.conversation_id": conversationId },
      () =>
        inngest.send({
          name: GUEST_TURN_REQUESTED_EVENT,
          data: {
            conversationId,
            phone,
            incomingMessage,
            triggerMessageId: userMessageId,
            correlationId,
            traceAnchor: anchor,
          },
        }),
    );

    // Empty <Response></Response> is valid TwiML that sends no message — the
    // real reply arrives later via the function's own proactive send.
    return new NextResponse("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("[guest-communication-agent] webhook handler failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
