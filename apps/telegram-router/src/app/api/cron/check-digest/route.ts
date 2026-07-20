import { type NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/telegram/auth";
import { recordDeliveryFailure } from "@/lib/telegram/delivery-failures";
import { getDigest } from "@/lib/telegram/orch-a";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

/**
 * Whatever real scheduler ends up existing (still an open deployment
 * question, same as check-reminders) should call this once a day. Pulls the
 * pre-rendered digest from apps/orch-a (pure logic, no Telegram awareness —
 * GET /digest) and sends it itself, with `parse_mode: "HTML"` preserved
 * (Orch-A's renderReport formats the digest with `<b>`/`<i>` tags — see
 * apps/orch-a/src/core/models.ts).
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { text } = await getDigest();
  const result = await sendWithRetry(() => sendMessage(text, undefined, { parseMode: "HTML" }));
  if (!result.ok) {
    console.error("[telegram-router] failed to send digest:", result.error);
    await recordDeliveryFailure("digest", text, result.error ?? "sendMessage failed");
  }

  return NextResponse.json({ delivered: result.ok });
}
