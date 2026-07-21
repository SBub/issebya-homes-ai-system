// Mirrors CRM's GET /api/guest-contacts/lookup response shape exactly
// (apps/crm/src/app/api/guest-contacts/lookup/route.ts) — `found: false`
// carries no other fields, since there's no row to report data from.
export type GuestContactLookup =
  | { found: true; last_room: string | null; last_stay_checkin: string | null; total_stays: number }
  | { found: false };

/**
 * Same configured-check shape as apps/finance's
 * src/lib/finance/guest-contacts.ts's guestContactsSyncConfigured().
 */
export function crmConfigured(): boolean {
  return Boolean(process.env.CRM_API_URL && process.env.CRM_API_KEY);
}

/**
 * Calls CRM's GET /api/guest-contacts/lookup?phone=... to fetch this
 * guest's past-stay facts (raw, uninterpreted — see that route's own doc
 * comment). `phone` can be passed in either form (Twilio's `whatsapp:`
 * prefix or bare) — CRM normalizes it server-side.
 *
 * CRITICAL RESILIENCE DECISION, deliberate, not an oversight: unlike every
 * other cross-app call in this repo (apps/finance's Notion/Telegram/CRM-sync
 * calls, all fire-and-forget side effects after a DB write that's already
 * committed), this function sits directly in GCA's real conversational
 * request path — src/graph/nodes/load-context.ts's loadContext() calls it
 * on every single turn, before the agent can reply at all. A CRM outage
 * must NOT break GCA's ability to reply to a guest. So: if CRM is
 * unconfigured, if the fetch itself fails (network error, CRM down), or if
 * CRM responds with a non-2xx status, this returns `null` — "no guest info
 * available" — rather than throwing. A warning is logged so the outage is
 * visible, but the guest-facing turn proceeds regardless. This is a
 * deliberate exception to how resilience is usually framed elsewhere in
 * this repo (there, it's "don't block on a non-critical side effect"; here,
 * it's "don't block the actual guest-facing feature on an optional
 * enrichment").
 */
export async function lookupGuestContact(phone: string): Promise<GuestContactLookup | null> {
  const baseUrl = process.env.CRM_API_URL;
  const apiKey = process.env.CRM_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }

  try {
    const res = await fetch(
      `${baseUrl}/api/guest-contacts/lookup?phone=${encodeURIComponent(phone)}`,
      { headers: { "X-API-Key": apiKey } },
    );
    if (!res.ok) {
      console.warn(`[guest-communication-agent] CRM lookup failed (${res.status})`);
      return null;
    }
    return (await res.json()) as GuestContactLookup;
  } catch (err) {
    console.warn(
      `[guest-communication-agent] CRM lookup errored: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export interface GuestContactRegisterResult {
  ok: boolean;
  error?: string;
}

/**
 * Calls CRM's POST /api/guest-contacts/register to create a phone-keyed stub
 * guest_contacts row the moment a brand-new whatsapp_conversation starts
 * (see the webhook route's use of getOrCreateActiveConversation's `isNew`
 * flag). Unlike lookupGuestContact above, this is NOT in the live
 * reply-blocking path — it fires after the conversation/message rows are
 * already committed to Postgres, as a side effect, the same category as
 * apps/finance's src/lib/finance/guest-contacts.ts's syncGuestContacts (a
 * "sync now" push after a DB write already succeeded). So this follows that
 * function's resilience shape, not lookupGuestContact's: it never throws,
 * and returns `{ ok: true }` both on success and when CRM isn't configured
 * (nothing to do), only surfacing `{ ok: false, error }` for the caller to
 * log — never to block or alter the guest-facing reply.
 */
export async function registerGuestContact(phone: string): Promise<GuestContactRegisterResult> {
  const baseUrl = process.env.CRM_API_URL;
  const apiKey = process.env.CRM_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/guest-contacts/register`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) {
      throw new Error(`guest-contacts register failed (${res.status}): ${await res.text()}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
