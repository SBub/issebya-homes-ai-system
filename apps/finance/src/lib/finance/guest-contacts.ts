export interface GuestContactsSyncResult {
  ok: boolean;
  error?: string;
}

/**
 * guest_contacts refresh is optional and best-effort, matching
 * notion.ts/telegram.ts's contract: Postgres (finance_bookings) is already
 * committed by the time this runs, so a missing
 * GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY (or
 * any delivery failure) must no-op / return a result object rather than
 * throwing — it's a supplementary sync, not a hard dependency for import to
 * succeed.
 */
export function guestContactsSyncConfigured(): boolean {
  return Boolean(
    process.env.GUEST_COMMUNICATION_AGENT_API_URL && process.env.GUEST_COMMUNICATION_AGENT_API_KEY,
  );
}

/**
 * Pushes a "sync now" request to apps/guest-communication-agent's
 * POST /api/guest-contacts/sync, which does its own read of
 * finance_bookings and upsert into its own guest_contacts table. This app
 * never reaches into GCA's tables directly — same cross-app-call pattern
 * as apps/telegram-router calling apps/notifications/apps/social-media/
 * apps/finance's own X-API-Key-guarded routes.
 */
export async function syncGuestContacts(): Promise<GuestContactsSyncResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/guest-contacts/sync`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`guest-contacts sync failed (${res.status}): ${await res.text()}`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
