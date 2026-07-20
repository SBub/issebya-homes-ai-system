import { AIMessage } from "@langchain/core/messages";
import { type NextRequest, NextResponse } from "next/server";
import { graph } from "@/graph/graph";
import { getOrCreateActiveConversation, recordMessage } from "@/lib/conversations";
import { verifyTwilioSignature } from "@/lib/twilio";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Receives inbound WhatsApp messages via Twilio's webhook format
 * (form-encoded body with From/Body/MessageSid etc.), validates a real
 * X-Twilio-Signature, then invokes GCA's ported LangGraph graph
 * (@/graph/graph.ts — the same reasoning/tools as issebya-homes-website's
 * apps/guest-communication-agent, faithfully ported, not redesigned — see
 * that source repo's own doc comments for the graph's design) and replies
 * synchronously via TwiML.
 *
 * Requires a real LangSmith prompt commit to actually produce a reply — the
 * agent node (@/graph/nodes/agent.ts) pulls its system prompt live from
 * LangSmith's Prompt Hub (whatsapp-booking-agent:production) rather than
 * from any file in this repo. Without access to that same LangSmith
 * org/prompt, a real inbound message fails at that step — expected, not a
 * port bug; see that file's own doc comment.
 *
 * Ported as-is, not yet decided: escalateToOwner (@/graph/tools.ts) and
 * agent.ts's step-cap safety net send Telegram notifications directly (own
 * bot token/chat ID) rather than through apps/telegram-router, unlike every
 * other app in this monorepo. Left as the source behaves for this faithful
 * port; revisit separately.
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

  const conversationId = await getOrCreateActiveConversation(phone);
  await recordMessage(conversationId, "user", incomingMessage);

  const result = await graph.invoke(
    { conversationId, phone, incomingMessage },
    // thread_id is required by the compiled graph's MemorySaver
    // checkpointer (LangGraph Studio supplies this implicitly per debug
    // session; a real caller must supply it explicitly). The conversation
    // is stateless per-turn regardless — Postgres is the system of record
    // (see graph.ts's own doc comment) — so reusing conversationId as the
    // thread_id just gives the ephemeral in-memory checkpoint a stable key
    // per conversation; it isn't relied on for persistence across restarts.
    { configurable: { conversationId, phone, thread_id: conversationId } },
  );

  const lastMessage = result.messages.at(-1);
  const replyText =
    lastMessage instanceof AIMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : "Sorry, I couldn't process that — please try again shortly.";

  await recordMessage(conversationId, "assistant", replyText);

  return new NextResponse(`<Response><Message>${escapeXml(replyText)}</Message></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
