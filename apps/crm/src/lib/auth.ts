import { type NextRequest, NextResponse } from "next/server";

/**
 * Shared X-API-Key check, checked against CRM_API_KEY — so these routes
 * can't be hit by anything except CRM's own callers (apps/finance,
 * apps/guest-communication-agent). Same pattern as apps/finance's and
 * apps/social-media's own requireApiKey.
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.CRM_API_KEY;
  if (!expected) {
    console.error("[crm] CRM_API_KEY is not set — all requests will be rejected");
  }
  const provided = request.headers.get("X-API-Key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
