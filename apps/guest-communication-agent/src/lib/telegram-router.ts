import type { EscalationReasonCategory } from "../graph/tools";

export interface EscalationNudgeResult {
  ok: boolean;
  telegramMessageId?: number;
  error?: string;
}

/**
 * Best-effort push to apps/telegram-router's POST /api/escalation-nudges,
 * which composes and sends the actual Telegram message notifying the owner
 * — see ../graph/tools.ts's performEscalation, the only caller, which now
 * routes all three escalation categories here (this used to be missing_info
 * only, with the other two bypassing telegram-router entirely via a raw
 * fetch straight to the Telegram Bot API — see ../lib/telegram.ts's
 * now-deleted sendTelegramNotification). reasonCategory/conversationId are
 * passed through so the route can compose a category-appropriate message —
 * missing_info gets a reply-inviting message, the other two get a plain
 * one-way alert with their own distinguishing prefix.
 *
 * Mirrors apps/crm's src/lib/telegram-router-client.ts's postCampaignDraft
 * resilience shape exactly: by the time this is called the escalations row
 * is already committed, so a missing TELEGRAM_ROUTER_API_URL/
 * TELEGRAM_ROUTER_API_KEY (or any delivery failure) must no-op / return a
 * result object rather than throwing — never roll back the insert, never
 * fail the whole escalation over a best-effort notification step. Unlike
 * postCampaignDraft, the success path here returns telegram-router's own
 * telegramMessageId so the caller can store it on the escalation row (the
 * correlation key the owner's later free-text reply gets matched against —
 * see the webhook's handleEscalationReply, which now guards on
 * reason_category before treating a reply as a missing_info answer).
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
