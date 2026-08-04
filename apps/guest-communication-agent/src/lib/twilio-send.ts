// Proactive outbound send via Twilio's REST API — separate from ./twilio.ts,
// which only verifies inbound requests.

export interface TwilioSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends via Twilio's Messages REST API. Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM (throws if any are missing).
 * Never throws on a Twilio API failure — returns `{ ok: false, error }` so
 * the caller can surface a clean error instead of an unhandled exception.
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
