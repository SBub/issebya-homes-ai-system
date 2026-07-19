import { type NextRequest, NextResponse } from "next/server";

/**
 * Checked against Telegram's X-Telegram-Bot-Api-Secret-Token header — set on
 * every request Telegram sends once the webhook is registered with a
 * `secret_token` (via setWebhook), so this endpoint can't be triggered by an
 * arbitrary POST body shaped like a Telegram update. Same
 * reject-with-response-or-null shape as apps/finance's requireApiKey.
 */
export function verifyWebhookSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[social-media] TELEGRAM_WEBHOOK_SECRET is not set — all webhook requests will be rejected",
    );
  }
  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
