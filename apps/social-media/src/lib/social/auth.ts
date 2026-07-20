import { type NextRequest, NextResponse } from "next/server";

/**
 * Shared X-API-Key check for /api/generate, checked against
 * SOCIAL_MEDIA_API_KEY — so this endpoint can't be hit by anything except
 * apps/telegram-router, the only caller. Same pattern as apps/finance's
 * requireApiKey.
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.SOCIAL_MEDIA_API_KEY;
  if (!expected) {
    console.error("[social-media] SOCIAL_MEDIA_API_KEY is not set — all requests will be rejected");
  }
  const provided = request.headers.get("X-API-Key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
