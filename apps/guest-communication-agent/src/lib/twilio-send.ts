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

/**
 * Approved-template counterpart to sendWhatsAppMessage, using `ContentSid` +
 * `ContentVariables` instead of free-text `Body`. Required for a campaign's
 * cold-open message — WhatsApp's 24h customer-service window means free-text
 * only works once a guest has replied recently (see
 * docs/whatsapp-campaign-templates.md). `contentSid` is caller-supplied; see
 * getTemplateSidForCampaignKind below to resolve one from a campaign kind.
 */
export async function sendWhatsAppTemplate(
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>,
): Promise<TwilioSendResult> {
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
        body: new URLSearchParams({
          From: from,
          To: toAddress,
          ContentSid: contentSid,
          ContentVariables: JSON.stringify(contentVariables),
        }).toString(),
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

// campaigns.kind -> env var holding that campaign's approved Content SID.
// One env var per kind so each can be set/rotated independently. Neither is
// set yet — both are unset until a real WABA and approved templates exist.
const CAMPAIGN_KIND_TEMPLATE_ENV_VAR: Record<string, string> = {
  returning_guest_discount: "TEMPLATE_SID_RETURNING_GUEST_DISCOUNT",
  winter_lockin_program: "TEMPLATE_SID_WINTER_LOCKIN_PROGRAM",
};

// Throws (rather than returning null) so a caller never sends with a
// garbage contentSid. Not called by any live code path yet.
export function getTemplateSidForCampaignKind(kind: string): string {
  const envVar = CAMPAIGN_KIND_TEMPLATE_ENV_VAR[kind];
  if (!envVar) {
    throw new Error(
      `No approved WhatsApp template is configured for campaign kind "${kind}" — add an entry to CAMPAIGN_KIND_TEMPLATE_ENV_VAR in twilio-send.ts once a template exists for it.`,
    );
  }

  const sid = process.env[envVar];
  if (!sid) {
    throw new Error(
      `${envVar} is not set — cannot send a template message for campaign kind "${kind}" until it is configured with an approved Content SID.`,
    );
  }

  return sid;
}
