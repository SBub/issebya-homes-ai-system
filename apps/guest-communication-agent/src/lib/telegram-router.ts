import type { OwnerNudgeReason } from "../agent/tools/owner-nudge";

export interface OwnerNudgeResult {
  ok: boolean;
  error?: string;
}

/**
 * Best-effort push to apps/telegram-router's POST /api/owner-nudges,
 * which composes and sends the Telegram message notifying the owner.
 * reasonCategory/conversationId let the route compose a category-appropriate
 * message (missing_info invites a reply, wants_human is a one-way alert).
 * correlationId (missing_info only) gets embedded by that route as a
 * `[ref:<correlationId>]` tag at the end of the nudge text, so a later owner
 * reply can be correlated back to the exact suspended run-guest-turn Inngest
 * function via Telegram's own `reply_to_message.text` — no DB round-trip
 * involved.
 *
 * A missing config or delivery failure returns a result object rather than
 * throwing — this is a best-effort notification, not something worth
 * failing the whole tool call over.
 */
export async function sendOwnerNudge(params: {
  phone: string;
  reason: string;
  reasonCategory: OwnerNudgeReason;
  conversationId: string;
  correlationId?: string;
}): Promise<OwnerNudgeResult> {
  const baseUrl = process.env.TELEGRAM_ROUTER_API_URL;
  const apiKey = process.env.TELEGRAM_ROUTER_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: true };
  }

  try {
    const res = await fetch(`${baseUrl}/api/owner-nudges`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `telegram-router owner-nudges failed (${res.status})`);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
