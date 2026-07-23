import { type NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/social/auth";
import { generateSocialPost } from "@/lib/social/generate";

/**
 * Plain logic API — no Telegram knowledge at all. apps/telegram-router calls
 * this with an idea, gets back the generated post, and decides how to
 * communicate it to the user itself.
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
    return NextResponse.json({
      altText: post.altText,
      caption: post.caption,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
