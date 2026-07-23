import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/social/auth";

/**
 * Shallow liveness check — no DB. A live network probe against OpenRouter
 * on every hourly check would burn quota and add latency for a check
 * that's supposed to be cheap and frequent; a misconfigured key
 * is already surfaced immediately and loudly when /api/generate actually
 * fails. Called by apps/telegram-router's check-health cron / /heartbeat
 * command.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json({ ok: true });
}
