export interface SendGuestMessageResult {
  ok: boolean;
  error?: string;
}

/**
 * Calls GCA's POST /api/send — guest-facing WhatsApp delivery once the owner
 * taps "✅ Approve" on a drafted campaign nudge.
 *
 * Missing config throws (a deployment mistake). A real send failure (GCA's
 * own {ok:false, error} response) is returned as `{ ok: false, error }`
 * instead, since the caller must branch on it, not treat it as an exception.
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
 * Calls GCA's GET /api/escalations/by-telegram-message-id/:id, checking
 * whether a replied-to message was one of GCA's own escalation nudges.
 *
 * A 404 is routine — most replies have nothing to do with an escalation —
 * so this returns null rather than throwing. Any other non-2xx still throws.
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
 * Calls GCA's POST /api/escalations/:id/resolve: persists the answer, writes
 * the KB entry, then wakes GCA's suspended DBOS workflow so it can compose
 * and send the real reply itself.
 *
 * `resumed` reports only whether the wake-up call reached a known workflow —
 * NOT whether the guest was actually messaged (that happens later, inside
 * the resumed workflow, invisible to this router). `resumed: false` lets the
 * caller give an honest "saved, but couldn't resume" message.
 *
 * A 409 (already resolved) is an expected outcome, returned as
 * `{ ok: false, alreadyResolved: true }` rather than thrown.
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
