export interface SendGuestMessageResult {
  ok: boolean;
  error?: string;
}

/**
 * Calls apps/guest-communication-agent's POST /api/send — the actual guest-
 * facing WhatsApp delivery once the owner taps "✅ Approve" on a drafted
 * campaign nudge (see ../../app/api/telegram/webhook/route.ts's
 * handleCallbackQuery). This sits in that request-handling path, which
 * needs to know whether the send actually succeeded before deciding to call
 * CRM's mark-sent — so, like ./crm.ts's getPromoCode, this surfaces enough
 * detail to branch on rather than swallowing a failure into `null` the way
 * a fire-and-forget call (e.g. apps/finance's syncGuestContacts) would.
 *
 * Missing config (GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY) throws, same
 * as this router's existing notifications.ts/social.ts clients — that's a
 * deployment mistake, not a normal operational outcome. A real send failure
 * (GCA's own {ok:false, error} 502 response, e.g. Twilio rejecting the
 * number) is instead returned as `{ ok: false, error }`, since that IS a
 * normal, expected-to-happen outcome the caller must branch on without it
 * being treated as an unhandled exception.
 */
export async function sendGuestMessage(
  phone: string,
  message: string,
): Promise<SendGuestMessageResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  const res = await fetch(`${baseUrl}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ phone, message }),
  });

  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return {
      ok: false,
      error: body.error ?? `guest-communication-agent /api/send failed (${res.status})`,
    };
  }
  return { ok: true };
}
