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

    const lines = ["Generated:", "", `Alt text: ${post.altText}`, "", `Caption: ${post.caption}`];
    if (!notionResult.ok) {
      lines.push("", `⚠️ Notion sync failed: ${notionResult.error}`);
    }
    await sendMessage(lines.join("\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[social-media] generation failed:", message);
    await sendMessage(`⚠️ Couldn't generate a social post: ${message}`);
  }

  return NextResponse.json({ ok: true });
}
