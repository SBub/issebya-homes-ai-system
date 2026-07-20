import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/social/auth";
import { generateSocialPost } from "@/lib/social/generate";
import { createSocialPost } from "@/lib/social/notion";

/**
 * Plain logic API — no Telegram knowledge at all. apps/telegram-router calls
 * this with an idea, gets back the generated post + Notion sync result, and
 * decides how to communicate it to the user itself.
 */
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  const body = await request.json().catch(() => null);
  const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
  if (!idea) {
    return NextResponse.json({ error: "idea is required" }, { status: 400 });
  }

  try {
    const post = await generateSocialPost(idea);
    const notionResult = await createSocialPost(idea, post);
    return NextResponse.json({
      altText: post.altText,
      caption: post.caption,
      notionOk: notionResult.ok,
      notionError: notionResult.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
