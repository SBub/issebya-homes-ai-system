import { type NextRequest, NextResponse } from "next/server";
import { verifyTwilioSignature } from "@/lib/gca/twilio";

const EMPTY_TWIML = "<Response></Response>";

/**
 * Scaffold only — receives inbound WhatsApp messages (Twilio's webhook
 * format: form-encoded body with From/Body/MessageSid etc., signed via
 * X-Twilio-Signature) and validates that signature for real, but does not
 * yet invoke GCA's actual agent.
 *
 * GCA's LangGraph graph currently lives in issebya-homes-website
 * (apps/guest-communication-agent there) and isn't wired to any live
 * WhatsApp traffic there either — confirmed against that repo's own
 * app-docs/production-integration-status.md: its "WhatsApp link" is just a
 * wa.me deep link, no webhook of any kind exists yet anywhere in that
 * monorepo. It hasn't been ported into this repo yet either — that repo is
 * currently mid-merge with unresolved conflicts, so porting is deliberately
 * deferred until that's resolved.
 *
 * TODO once GCA is ported here: replace the stub log below with an actual
 * call into GCA's graph (load_context -> agent <-> tools -> END); add local
 * Postgres tables for whatsapp_conversations/whatsapp_messages/escalations
 * (mirrored from that repo's
 * supabase/migrations/20260702000001_whatsapp_agent.sql — nothing like that
 * exists in this repo's Supabase yet); and decide whether escalation alerts
 * should route through apps/telegram-router (consistent with how every
 * other app in this repo sends Telegram) instead of the source
 * implementation's current direct Telegram send.
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

  console.log(`[guest-communication-agent] inbound WhatsApp message from ${params.From}`);

  // TODO: invoke GCA's graph here once it's ported into this repo — see the
  // doc comment above.

  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
