import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/telegram/auth";
import { parseSocialCommand } from "@/lib/telegram/command";
import { acknowledgeReminder } from "@/lib/telegram/notifications";
import { generateSocialPost } from "@/lib/telegram/social";
import type { TelegramUpdate } from "@/lib/telegram/telegram";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/telegram/telegram";

const DONE_PREFIX = "done:";

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const { id: callbackQueryId, data, message } = callbackQuery;
  if (!data?.startsWith(DONE_PREFIX)) {
    await answerCallbackQuery(callbackQueryId);
    return;
  }

  const key = data.slice(DONE_PREFIX.length);
  try {
    await acknowledgeReminder(key);
    await answerCallbackQuery(callbackQueryId, "Marked done ✅");
    if (message) {
      await editMessageText(message.message_id, `${message.text ?? ""}\n\n✅ Marked done`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[telegram-router] reminder ack failed:", errorMessage);
    await answerCallbackQuery(callbackQueryId, "Failed to mark done — try again");
  }
}

/**
 * The one Telegram webhook for the whole system. Owns all Telegram I/O and
 * dispatches by command to plain logic APIs in other apps — /social ->
 * apps/social-media, a reminder's "✅ Done" button -> apps/notifications.
 * Always returns 200 once the request is authenticated and parsed, even on
 * downstream failure — a non-2xx response makes Telegram retry the whole
 * update, which would just re-trigger the same action rather than fix
 * anything.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyWebhookSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;

  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return NextResponse.json({ ok: true });
  }

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
