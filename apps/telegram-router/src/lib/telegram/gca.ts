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

export type AnswerOwnerNudgeResult = { ok: true } | { ok: false; error: string };

/**
 * Calls GCA's POST /api/owner-nudges/:correlationId/answer: writes the KB
 * entry, then sends the event that wakes GCA's suspended run-guest-turn
 * Inngest function so it can compose and send the real reply itself.
 * `correlationId` is the suspended function's own correlation id, extracted
 * by the webhook route straight out of the owner's Telegram reply (the
 * `[ref:<correlationId>]` tag embedded in the original missing_info nudge)
 * — there's no DB lookup involved anymore.
 *
 * Unlike the old DBOS-backed version, GCA has no way to tell us whether a
 * suspended run was actually still waiting on this answer — Inngest gives no
 * such signal (sending an event nobody's waiting on isn't an error, it's
 * simply never consumed). So this only reports whether the call itself
 * succeeded, NOT whether the guest was actually messaged (that happens
 * later, inside the resumed run, invisible to this router either way) and
 * NOT whether anything was actually resumed. There's no more 409/
 * already-resolved outcome — no DB row exists to hold that state.
 */
export async function answerOwnerNudge(
  correlationId: string,
  answer: string,
): Promise<AnswerOwnerNudgeResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  const res = await fetch(
    `${baseUrl}/api/owner-nudges/${encodeURIComponent(correlationId)}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ answer }),
    },
  );

  if (!res.ok) {
    return {
      ok: false,
      error: `GCA answer for correlationId ${correlationId} failed (${res.status}): ${await res.text()}`,
    };
  }
  return { ok: true };
}
