import { type NextRequest, NextResponse } from "next/server";

/**
 * Shared X-API-Key check for every /api/finance/* route, checked against
 * FINANCE_API_KEY. Also reused as the /upload page's password field — no
 * separate auth system.
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.FINANCE_API_KEY;
  if (!expected) {
    console.error("[finance] FINANCE_API_KEY is not set — all requests will be rejected");
  }
  const provided = request.headers.get("X-API-Key");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
