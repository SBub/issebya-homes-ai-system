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
 * Receives inbound WhatsApp messages via Twilio's webhook format
 * (form-encoded body with From/Body/MessageSid etc.), validates a real
 * X-Twilio-Signature, then runs GCA's agent turn (@/agent/run-turn.ts — the
 * same reasoning/tools as issebya-homes-website's
 * apps/guest-communication-agent, faithfully ported, not redesigned) and
 * replies synchronously via TwiML.
 *
 * Requires a real LangSmith prompt commit to actually produce a reply —
 * runAgentTurn pulls its system prompt live from LangSmith's Prompt Hub
 * (whatsapp-booking-agent:production) rather than from any file in this
 * repo. Without access to that same LangSmith org/prompt, a real inbound
 * message fails at that step — expected, not a bug; see run-turn.ts's own
 * doc comment.
 *
 * escalateToOwner (@/agent/tools/escalation.ts) and run-turn.ts's two
 * deterministic safety nets all notify the owner via apps/telegram-router's
 * POST /api/escalation-nudges — see @/lib/telegram-router.ts's
 * sendEscalationNudge for the actual mechanism.
 *
 * When this turn's `result.missingInfoEscalated` comes back true (a
 * missing_info escalation fired this turn — either the model's own
 * escalateToOwner tool call, or one of run-turn.ts's two deterministic
 * safety nets), the interim reply is never delivered to the guest (empty
 * `<Response></Response>` TwiML) AND never recorded into whatsapp_messages
 * at all. Recording was tried first (kept for internal/CRM visibility) but
 * caused a real failure: when the owner later answers on Telegram and GCA's
 * proactive re-invocation (@/lib/resume-conversation.ts's
 * resumeConversationWithAnswer) re-invokes runAgentTurn with the guest's
 * original question, loadContext (@/agent/load-context.ts) loads that
 * recorded interim reply ("I couldn't find an answer... I've let the owner
 * know") as history sitting right before the repeated question — and a real
 * test showed the model reading that as "I already told them I'd check",
 * skipping answerPropertyQuestion entirely on the re-invocation and
 * escalating a second time instead of finding the freshly-embedded answer.
 * Not recording the interim turn at all avoids that trap: the re-invocation
 * sees the guest's own question with nothing misleading in between.
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

  // Fire-and-forget: register a phone-keyed CRM stub the moment this guest's
  // first conversation starts. Never blocks/fails the guest-facing reply —
  // registerGuestContact() itself never throws (see its own doc comment),
  // and this route replies via TwiML, not JSON, so there's no response body
  // to attach a warning to like apps/finance's import route does; a
  // console.warn is the only signal on failure.
  if (isNew) {
    const result = await registerGuestContact(phone);
    if (!result.ok) {
      console.warn(
        `[guest-communication-agent] registerGuestContact failed for ${phone}: ${result.error}`,
      );
    }
  }

  // Generated up front (rather than read back off a trace after the fact)
  // purely as this turn's whatsapp_messages.langsmith_run_id / eval-feedback
  // correlation id (POST /api/messages/[messageId]/feedback calls
  // langsmithClient.createFeedback(langsmithRunId, ...) against it) — NOT,
  // as of the LangChain -> Vercel AI SDK migration, a real LangSmith trace
  // id anymore. LangChain had automatic LangSmith tracing baked in (this
  // UUID used to be threaded into ChatOpenAI.invoke()'s RunnableConfig.runId,
  // which LangChain's tracer used as the root run id); Vercel AI SDK has no
  // such automatic integration — it has its own OpenTelemetry-based
  // `experimental_telemetry` instead, which is not wired up to LangSmith
  // here. So this UUID is now just an opaque id with nothing on LangSmith's
  // side to match it: a later "flag after" feedback submission's
  // createFeedback call against it will fail against LangSmith (a real
  // regression from the pre-migration behavior, not addressed by this
  // change — see run-turn.ts's migration doc comment / the migration's own
  // PR notes for the full investigation).
  const runId = crypto.randomUUID();

  const result = await runAgentTurn(
    { conversationId, phone, incomingMessage },
    // triggerMessageId is this turn's own inbound whatsapp_messages.id
    // (captured just above, before any tool call can fire) — threaded
    // through so a mid-turn escalateToOwner call
    // (@/agent/tools/escalation.ts's performEscalation) can store it on the
    // escalations row as trigger_message_id. That's what lets a later
    // missing_info resolution re-invoke runAgentTurn with the guest's real
    // original question text, instead of the model's own paraphrased
    // `reason` — see @/lib/resume-conversation.ts.
    { triggerMessageId: userMessageId },
  );

  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage?.role === "assistant" && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Sorry, I couldn't process that — please try again shortly.";

  // Skipped entirely (not just undelivered) for a missing_info escalation —
  // see this route's own doc comment above for why recording it broke the
  // later re-invocation.
  if (!result.missingInfoEscalated) {
    await recordMessage(conversationId, "assistant", replyText, runId);
  }

  // Fire-and-forget: record this turn's guest interaction and, if the
  // tools that fired this turn imply funnel-stage progress, let CRM
  // advance guest_contacts.funnel_stage (CRM owns the forward-only upgrade
  // logic; this route just derives the hint — see funnel-stage.ts's own
  // doc comment for the derivation rules and lib/crm.ts's touchGuestContact
  // for why this never blocks/fails the guest-facing reply, exactly like
  // registerGuestContact above).
  const stageHint = deriveStageHint(result.messages);
  const touchResult = await touchGuestContact(phone, stageHint);
  if (!touchResult.ok) {
    console.warn(
      `[guest-communication-agent] touchGuestContact failed for ${phone}: ${touchResult.error}`,
    );
  }

  // A missing_info escalation's interim reply is deliberately never
  // delivered to the guest (see this route's own header doc comment) — the
  // guest hears nothing until the owner answers on Telegram and GCA's
  // proactive re-invocation (@/lib/resume-conversation.ts) sends the real
  // answer. An empty <Response></Response> is valid TwiML that sends no
  // message, so Twilio doesn't relay replyText to the guest for this turn.
  const twiml = result.missingInfoEscalated
    ? "<Response></Response>"
    : `<Response><Message>${escapeXml(replyText)}</Message></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
