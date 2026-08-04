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

export type AnswerOwnerNudgeResult = { ok: true; resumed: boolean } | { ok: false; error: string };

/**
 * Calls GCA's POST /api/owner-nudges/:workflowId/answer: writes the KB
 * entry, then wakes GCA's suspended DBOS workflow so it can compose and
 * send the real reply itself. `workflowId` is the suspended DBOS workflow's
 * own id, extracted by the webhook route straight out of the owner's
 * Telegram reply (the `[ref:<workflowId>]` tag embedded in the original
 * missing_info nudge) — there's no DB lookup involved anymore.
 *
 * `resumed` reports only whether the wake-up call reached a known workflow —
 * NOT whether the guest was actually messaged (that happens later, inside
 * the resumed workflow, invisible to this router). `resumed: false` lets the
 * caller give an honest "saved, but couldn't resume" message (e.g. a
 * duplicate/late reply after the workflow already resumed or expired — see
 * GCA's handleMissingInfoReplyReceived for why that's safe rather than an
 * error). There's no more 409/already-resolved outcome — no DB row exists
 * to hold that state.
 */
export async function answerOwnerNudge(
  workflowId: string,
  answer: string,
): Promise<AnswerOwnerNudgeResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  const res = await fetch(`${baseUrl}/api/owner-nudges/${encodeURIComponent(workflowId)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ answer }),
  });

  if (!res.ok) {
    return {
      ok: false,
      error: `GCA answer for workflow ${workflowId} failed (${res.status}): ${await res.text()}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as { resumed?: boolean };
  return { ok: true, resumed: body.resumed ?? false };
}
