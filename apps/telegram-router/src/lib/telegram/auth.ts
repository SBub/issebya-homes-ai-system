import { type NextRequest, NextResponse } from "next/server";

/**
 * Checked against Telegram's X-Telegram-Bot-Api-Secret-Token header — set on
 * every request Telegram sends once the webhook is registered with a
 * `secret_token` (via setWebhook), so this endpoint can't be triggered by an
 * arbitrary POST body shaped like a Telegram update.
 */
export function verifyWebhookSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[telegram-router] TELEGRAM_WEBHOOK_SECRET is not set — all webhook requests will be rejected",
    );
  }
  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Checked against a shared X-Cron-Secret header — protects
 * /api/cron/check-reminders from being triggered by anything except
 * whatever real scheduler ends up calling it (still an open question, same
 * as the rest of this repo's deployment/hosting question).
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[telegram-router] CRON_SECRET is not set — all cron requests will be rejected");
  }
  const provided = request.headers.get("X-Cron-Secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Shared X-Api-Key check for POST /api/campaign-drafts, checked against
 * TELEGRAM_ROUTER_API_KEY — same requireApiKey pattern every other app in
 * this repo already uses (apps/crm's, apps/finance's,
 * apps/guest-communication-agent's own requireApiKey), this app just hasn't
 * needed one before now: it's only ever been a caller of other apps'
 * X-API-Key-guarded routes (verifyWebhookSecret/verifyCronSecret above
 * guard this app's own inbound routes instead), never a callee itself.
 * apps/crm's POST /api/cron/check-stalled-guests is the first caller,
 * via src/lib/telegram-router-client.ts's postCampaignDraft.
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.TELEGRAM_ROUTER_API_KEY;
  if (!expected) {
    console.error(
      "[telegram-router] TELEGRAM_ROUTER_API_KEY is not set — all requests will be rejected",
    );
  }
  const provided = request.headers.get("X-API-Key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
