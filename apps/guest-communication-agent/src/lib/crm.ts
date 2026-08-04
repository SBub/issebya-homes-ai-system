// Mirrors CRM's GET /api/guest-contacts/lookup response shape exactly —
// `found: false` carries no other fields.
export type GuestContactLookup =
  | { found: true; last_room: string | null; last_stay_checkin: string | null; total_stays: number }
  | { found: false };

export function crmConfigured(): boolean {
  return Boolean(process.env.CRM_API_URL && process.env.CRM_API_KEY);
}

/**
 * Fetches this guest's past-stay facts from CRM. `phone` can be passed in
 * either form — CRM normalizes it server-side.
 *
 * Called on every turn before the agent can reply, so a CRM outage must not
 * break GCA's ability to reply: returns null (not a throw) when unconfigured,
 * on a fetch failure, or on a non-2xx status. Logs a warning either way.
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

// Creates a phone-keyed stub guest_contacts row when a brand-new
// whatsapp_conversation starts (see getOrCreateActiveConversation's `isNew`).
// Fires after the conversation/message rows are already committed, so
// unlike lookupGuestContact this never throws — `{ ok: true }` on success or
// when CRM isn't configured, `{ ok: false, error }` only for the caller to log.
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

export type FunnelStageHint = "informed" | "link_sent" | "booked";

export interface GuestContactTouchResult {
  ok: boolean;
  error?: string;
}

// Called once per turn, after the reply is already produced, to bump
// last_interaction_at and (via `stageHint`) let CRM advance
// guest_contacts.funnel_stage — CRM owns the forward-only upgrade logic.
// Same resilience shape as registerGuestContact: never throws.
export async function touchGuestContact(
  phone: string,
  stageHint?: FunnelStageHint,
): Promise<GuestContactTouchResult> {
  const baseUrl = process.env.CRM_API_URL;
  const apiKey = process.env.CRM_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/guest-contacts/touch`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ phone, stageHint }),
    });
    if (!res.ok) {
      throw new Error(`guest-contacts touch failed (${res.status}): ${await res.text()}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
