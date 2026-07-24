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

/**
 * Sends an outbound WhatsApp message via Twilio's Content API — the
 * approved-template counterpart to sendWhatsAppMessage above. Same
 * auth/env-var requirements, same "never throws on a Twilio API failure,
 * does throw on missing deployment config" contract, same return shape —
 * the only difference is the POST body: `ContentSid` (the Content SID of a
 * template already created and approved in Twilio's Content Template
 * Builder / Meta Business Manager — see
 * docs/whatsapp-campaign-templates.md) and `ContentVariables` (a
 * JSON-stringified object of positional variables, e.g. `{"1": "Jane"}`)
 * instead of a free-text `Body`.
 *
 * This exists because WhatsApp's 24-hour customer-service window (see
 * docs/whatsapp-campaign-templates.md §1) makes sendWhatsAppMessage's
 * free-text Body unusable for any campaign's cold-open message — every
 * campaign in this system messages a guest who hasn't messaged us
 * recently, which is exactly the case Meta requires a pre-approved
 * template for. Once a guest replies to a template, a fresh 24-hour window
 * opens and sendWhatsAppMessage (free-text) is fine again for that
 * conversation — this function is only for the first, cold-open send.
 *
 * `contentSid` is a caller-supplied Content SID, not looked up here — see
 * getTemplateSidForCampaignKind below for how a caller resolves a
 * campaign's kind to its configured SID.
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

/**
 * campaigns.kind (apps/crm/src/lib/campaigns.ts's Campaign.kind — a free
 * descriptive string, not a fixed enum) -> the env var name holding that
 * campaign's approved Content SID. One env var per kind, rather than a
 * single JSON-encoded env var, so each campaign's template SID can be set,
 * rotated, or left unset independently in whatever secrets store this
 * deploys to — consistent with every other per-concern env var this app
 * already uses (TWILIO_ACCOUNT_SID, CRM_API_KEY, etc.), and avoids a
 * partial-parse failure mode where one malformed entry in a shared JSON
 * blob breaks every campaign's lookup at once.
 *
 * No real Content SID exists for either campaign yet (see
 * docs/whatsapp-campaign-templates.md §3 for the drafted-but-not-yet-
 * submitted template copy) — both env vars are expected to be unset until
 * a real WABA and approved templates exist. Add a new entry here (kind ->
 * new env var name) the day a third campaign gets its own template.
 */
const CAMPAIGN_KIND_TEMPLATE_ENV_VAR: Record<string, string> = {
  returning_guest_discount: "TEMPLATE_SID_RETURNING_GUEST_DISCOUNT",
  winter_lockin_program: "TEMPLATE_SID_WINTER_LOCKIN_PROGRAM",
};

/**
 * Resolves a campaign kind to its configured Content SID. Throws — rather
 * than silently returning null/undefined and letting a caller send with a
 * garbage `contentSid` — in both gap cases: a kind with no entry in
 * CAMPAIGN_KIND_TEMPLATE_ENV_VAR at all (no template has ever been drafted
 * for it), and a kind with an entry whose env var isn't set yet (a
 * template exists conceptually but hasn't been approved/configured in this
 * environment). Not called by any live code path yet — see this module's
 * own follow-up note and docs/whatsapp-campaign-templates.md §5 for why
 * wiring this into the approval pipeline is deliberately a separate,
 * later change.
 */
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
