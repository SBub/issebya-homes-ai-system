// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/lib/telegram.ts — raw fetch to the
// Telegram Bot API, no SDK, just two env vars. Sends directly rather than
// through apps/telegram-router (this repo's established "one app owns all
// Telegram I/O" pattern for everything else) — kept as-is for this port,
// per an explicit scope decision to port faithfully first and revisit
// routing separately. See docs re: this open decision.
export async function sendTelegramNotification(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log("[telegram] Not configured — skipping notification");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    console.log(`[telegram] notification: ${res.status}`);
  } catch (err) {
    console.error("[telegram] Failed to send notification:", err);
  }
}
