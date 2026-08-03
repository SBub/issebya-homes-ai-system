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

export interface EscalationByTelegramMessageId {
  id: string;
  phone_number: string;
  reason: string;
  reason_category: string;
  resolved_at: string | null;
  answer: string | null;
}

/**
 * Calls GCA's GET /api/escalations/by-telegram-message-id/:id — the webhook
 * route's new reply-to-nudge branch (../../app/api/telegram/webhook/route.ts)
 * calls this first, on every message that replies to another message, to
 * check whether the replied-to message was actually one of GCA's own
 * missing_info escalation nudges.
 *
 * A 404 is a normal, routine outcome here — most replies in the owner's chat
 * have nothing to do with an escalation — so this returns `null` rather than
 * throwing, unlike ./crm.ts's getPromoCode (whose 404 really would be a bug:
 * it's always called with a promoCodeId this router itself just parsed out
 * of its own callback_data, so there's no legitimate "doesn't exist" case).
 * Any other non-2xx is a real failure and still throws, same as getPromoCode.
 */
export async function getEscalationByTelegramMessageId(
  telegramMessageId: number,
): Promise<EscalationByTelegramMessageId | null> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  const res = await fetch(
    `${baseUrl}/api/escalations/by-telegram-message-id/${telegramMessageId}`,
    { headers: { "X-API-Key": apiKey } },
  );

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `GCA GET /api/escalations/by-telegram-message-id/${telegramMessageId} failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as EscalationByTelegramMessageId;
}

export type ResolveEscalationResult =
  | { ok: true; resumed: boolean }
  | { ok: false; alreadyResolved: boolean; error?: string };

/**
 * Calls GCA's POST /api/escalations/:id/resolve — the single call that
 * handles the whole missing_info resolution flow on GCA's side: persists the
 * answer, writes the new knowledge-base entry, then wakes GCA's suspended
 * DBOS workflow (@/agent/run-guest-turn.ts in GCA) for that guest turn so it
 * can compose and send the real reply itself.
 *
 * `resumed` on a successful (`ok: true`) response reports only whether that
 * wake-up call was dispatched to a known, live workflow — NOT whether the
 * guest was actually messaged. GCA's own reply now happens later,
 * asynchronously, inside the resumed workflow (which may take anywhere from
 * milliseconds to longer, and could still fail on GCA's side after this call
 * returns) — this router has no visibility into that outcome at all anymore.
 * `resumed: false` means GCA couldn't find a workflow to wake for this
 * escalation (e.g. it predates workflow correlation) — the caller uses this
 * to give the owner an honest "the answer was saved, but I couldn't resume
 * the conversation" message rather than falsely implying delivery either way.
 *
 * Mirrors ./crm.ts's markPromoCodeRejected shape: a 409 (already resolved —
 * a double reply or a Telegram webhook retry racing this same escalation) is
 * an expected outcome the caller must branch on, not an exception, so it's
 * returned as `{ ok: false, alreadyResolved: true }` rather than thrown.
 */
export async function resolveEscalation(
  escalationId: string,
  answer: string,
): Promise<ResolveEscalationResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  const res = await fetch(
    `${baseUrl}/api/escalations/${encodeURIComponent(escalationId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ answer }),
    },
  );

  if (res.status === 409) {
    return { ok: false, alreadyResolved: true };
  }
  if (!res.ok) {
    return {
      ok: false,
      alreadyResolved: false,
      error: `GCA resolve for escalation ${escalationId} failed (${res.status}): ${await res.text()}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as { resumed?: boolean };
  return { ok: true, resumed: body.resumed ?? false };
}
