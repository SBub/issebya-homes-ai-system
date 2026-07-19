import { type NextRequest, NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/social/auth";
import { parseSocialCommand } from "@/lib/social/command";
import { generateSocialPost } from "@/lib/social/generate";
import { createSocialPost } from "@/lib/social/notion";
import type { TelegramUpdate } from "@/lib/social/telegram";
import { sendMessage } from "@/lib/social/telegram";

/**
 * Telegram webhook receiver for the /social command (see
 * docs/agent-architecture.mmd SOC_GEN). Always returns 200 once the request
 * is authenticated and parsed, even on downstream generation/sync failure —
 * a non-2xx response makes Telegram retry the whole update, which would just
 * re-trigger generation identically rather than fix anything.
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
    const post = await generateSocialPost(idea);
    const notionResult = await createSocialPost(idea, post);

    // Sent as separate messages, each with no label text, so Telegram's
    // long-press -> Copy grabs exactly one field, paste-ready, with nothing
    // to strip off first.
    await sendMessage(post.altText);
    await sendMessage(post.caption);
    if (!notionResult.ok) {
      await sendMessage(`⚠️ Notion sync failed: ${notionResult.error}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[social-media] generation failed:", message);
    await sendMessage(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
