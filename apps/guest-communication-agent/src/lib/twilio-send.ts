// Proactive outbound send, via Twilio's REST API directly — kept in its own
// file rather than folded into ./twilio.ts, since that file is entirely
// about verifying INBOUND requests (verifyTwilioSignature) and this is an
// unrelated OUTBOUND concern; ./twilio.ts's existing exports are untouched.
//
// Until now this app has only ever replied synchronously as TwiML inside
// the inbound webhook call (see src/app/api/webhook/whatsapp/route.ts) — it
// has never proactively sent a message on its own initiative. This is what
// makes that possible, for the new POST /api/send route.

export interface TwilioSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends an outbound WhatsApp message via Twilio's Messages REST API
 * (POST .../Messages.json, Basic Auth with Account SID/Auth Token,
 * form-encoded body). Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
 * TWILIO_WHATSAPP_FROM (the Sandbox's `whatsapp:+1...` sender number) to all
 * be set — TWILIO_AUTH_TOKEN alone (used today only for inbound signature
 * verification) is not sufficient for outbound calls, which authenticate
 * with Account SID + Auth Token together.
 *
 * `to` is normalized to always carry the `whatsapp:` prefix Twilio's
 * WhatsApp API requires, regardless of whether the caller already included
 * it (mirrors apps/crm's normalizePhone's tolerance for either form on the
 * read side, just in the opposite direction here).
 *
 * Never throws on a Twilio API failure (invalid number, rate limit, etc.)
 * — returns `{ ok: false, error }` so the caller (POST /api/send) can
 * surface a clean 502 instead of an unhandled exception. Does still throw
 * if the required env vars are missing, since that's a deployment
 * misconfiguration, not a runtime/external-API failure.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<TwilioSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !from) {
    throw new Error(
      "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM must all be set to send outbound WhatsApp messages",
    );
  }

  const toAddress = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: toAddress, Body: body }).toString(),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Twilio send failed (${res.status}): ${text}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
