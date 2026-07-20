import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/telegram/auth";
import { parseSocialCommand } from "@/lib/telegram/command";
import { generateSocialPost } from "@/lib/telegram/social";
import type { TelegramUpdate } from "@/lib/telegram/telegram";
import { sendMessage } from "@/lib/telegram/telegram";

/**
 * The one Telegram webhook for the whole system. Owns all Telegram I/O and
 * dispatches by command to plain logic APIs in other apps — currently just
 * /social -> apps/social-media. Always returns 200 once the request is
 * authenticated and parsed, even on downstream failure — a non-2xx response
 * makes Telegram retry the whole update, which would just re-trigger
 * generation identically rather than fix anything.
 *
 * callback_query handling (e.g. a future "done:<key>" button press for
 * reminders) isn't here yet — nothing sends buttons yet, so there's nothing
 * to dispatch to.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyWebhookSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const idea = update ? parseSocialCommand(update) : null;
  if (!idea) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await generateSocialPost(idea);
    await sendMessage(result.altText);
    await sendMessage(result.caption);
    if (!result.notionOk) {
      await sendMessage(`⚠️ Notion sync failed: ${result.notionError}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] generation failed:", message);
    await sendMessage(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
