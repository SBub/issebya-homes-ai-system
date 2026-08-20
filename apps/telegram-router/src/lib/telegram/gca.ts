import { markSpanFailed, withSpan } from "@/lib/tracing";

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

  return withSpan("gca.relay.send_guest_message", { "gca.endpoint": "/api/send" }, async (span) => {
    const res = await fetch(`${baseUrl}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ phone, message }),
    });

    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      const error = body.error ?? `guest-communication-agent /api/send failed (${res.status})`;
      markSpanFailed(span, error);
      return { ok: false, error };
    }
    return { ok: true };
  });
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

  return withSpan(
    "gca.relay.answer_owner_nudge",
    {
      "gca.endpoint": "/api/owner-nudges/:correlationId/answer",
      "gca.correlation_id": correlationId,
    },
    async (span) => {
      const res = await fetch(
        `${baseUrl}/api/owner-nudges/${encodeURIComponent(correlationId)}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({ answer }),
        },
      );

      if (!res.ok) {
        const error = `GCA answer for correlationId ${correlationId} failed (${res.status}): ${await res.text()}`;
        markSpanFailed(span, error);
        return { ok: false, error };
      }
      return { ok: true };
    },
  );
}

export type AnswerBookingLinkApprovalResult = { ok: true } | { ok: false; error: string };

/**
 * Calls GCA's POST /api/owner-nudges/:correlationId/approve: relays the
 * owner's approve/reject decision (tapped as a Telegram button, not typed as
 * free text) so GCA can send the event that wakes its suspended
 * run-guest-turn Inngest function — see booking.ts's
 * waitForBookingLinkApproval/handleBookingLinkApprovalReceived.
 * `correlationId` rides directly in the tapped button's callback_data (see
 * the webhook route's handleCallbackQuery), not parsed out of reply text the
 * way answerOwnerNudge's missing_info flow does.
 *
 * Same "no resumed signal" contract as answerOwnerNudge: GCA has no way to
 * tell us whether a suspended run was actually still waiting on this
 * decision, so this only reports whether the call itself succeeded. A
 * duplicate tap (or webhook retry) just resends an event nobody's waiting on
 * if it was already resolved — a safe no-op, same reasoning as
 * answerOwnerNudge, which is also why there's no DB-backed double-tap guard
 * possible here (there's no row to check).
 */
export async function answerBookingLinkApproval(
  correlationId: string,
  approved: boolean,
): Promise<AnswerBookingLinkApprovalResult> {
  const baseUrl = process.env.GUEST_COMMUNICATION_AGENT_API_URL;
  const apiKey = process.env.GUEST_COMMUNICATION_AGENT_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
  }

  return withSpan(
    "gca.relay.answer_booking_link_approval",
    {
      "gca.endpoint": "/api/owner-nudges/:correlationId/approve",
      "gca.correlation_id": correlationId,
      "gca.approved": approved,
    },
    async (span) => {
      const res = await fetch(
        `${baseUrl}/api/owner-nudges/${encodeURIComponent(correlationId)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({ approved }),
        },
      );

      if (!res.ok) {
        const error = `GCA approve for correlationId ${correlationId} failed (${res.status}): ${await res.text()}`;
        markSpanFailed(span, error);
        return { ok: false, error };
      }
      return { ok: true };
    },
  );
}
