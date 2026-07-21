import { type NextRequest, NextResponse } from "next/server";

/**
 * Shared X-API-Key check for POST /api/send, checked against
 * GUEST_COMMUNICATION_AGENT_API_KEY. Same pattern as apps/crm's,
 * apps/finance's, and apps/notifications's own requireApiKey.
 *
 * This app's only other route, POST /api/webhook/whatsapp, is guarded by
 * Twilio's own request signature (see ./twilio.ts's verifyTwilioSignature),
 * NOT by an API key — that route is a public inbound webhook Twilio calls
 * directly, so an API key wouldn't make sense there. This new /api/send
 * route is different: it's a proactive-send endpoint meant to be called
 * only by this monorepo's own services (a later phase's Telegram
 * approve/reject flow), so it needs the same caller-authentication scheme
 * every other internal-only route in this repo uses.
 *
 * GUEST_COMMUNICATION_AGENT_API_KEY existed in this app before the CRM
 * extraction removed the route it guarded; this reintroduces the same env
 * var name for this new, different route.
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!expected) {
    console.error(
      "[guest-communication-agent] GUEST_COMMUNICATION_AGENT_API_KEY is not set — all requests will be rejected",
    );
  }
  const provided = request.headers.get("X-API-Key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
