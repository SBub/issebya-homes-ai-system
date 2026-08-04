import type { EscalationReasonCategory } from "../agent/tools/escalation-shared";

export interface EscalationNudgeResult {
  ok: boolean;
  telegramMessageId?: number;
  error?: string;
}

/**
 * Best-effort push to apps/telegram-router's POST /api/escalation-nudges,
 * which composes and sends the Telegram message notifying the owner.
 * reasonCategory/conversationId let the route compose a category-appropriate
 * message (missing_info invites a reply, the others are one-way alerts).
 *
 * The escalations row is already committed by the time this runs, so a
 * missing config or delivery failure returns a result object rather than
 * throwing — never roll back the insert over a best-effort notification.
 * On success, returns telegram-router's telegramMessageId so the caller can
 * store it as the correlation key for the owner's later reply.
 */
export async function sendEscalationNudge(params: {
  escalationId: string;
  phone: string;
  reason: string;
  reasonCategory: EscalationReasonCategory;
  conversationId: string;
}): Promise<EscalationNudgeResult> {
  const baseUrl = process.env.TELEGRAM_ROUTER_API_URL;
  const apiKey = process.env.TELEGRAM_ROUTER_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/escalation-nudges`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => ({}))) as {
      telegramMessageId?: number;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(body.error ?? `telegram-router escalation-nudges failed (${res.status})`);
    }
    return { ok: true, telegramMessageId: body.telegramMessageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
