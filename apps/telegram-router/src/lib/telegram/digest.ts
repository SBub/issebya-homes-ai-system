// Alias imports, not relative — works around a known Turbopack bug where
// relative imports to newly-added sibling files fail to resolve in dev (see
// apps/social-media/vitest.config.ts's comment for the full story).
import { recordDeliveryFailure } from "@/lib/telegram/delivery-failures";
import { getDigest } from "@/lib/telegram/orch-a";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Renders and sends Orch-A's digest right now — shared by the scheduled
 * check-digest cron route and the on-demand /digest command, so both get
 * the same retry-once + durable-fallback behavior.
 */
export async function sendDigestNow(): Promise<{ delivered: boolean }> {
  const { text } = await getDigest();
  const result = await sendWithRetry(() => sendMessage(text, undefined, { parseMode: "HTML" }));
  if (!result.ok) {
    console.error("[telegram-router] failed to send digest:", result.error);
    await recordDeliveryFailure("digest", text, result.error ?? "sendMessage failed");
  }
  return { delivered: result.ok };
}
