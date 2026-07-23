import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/finance/auth";
import { pool } from "@/lib/finance/db";

export const runtime = "nodejs";

/**
 * Deep liveness check — Postgres holds finance_bookings; a DB outage here
 * means CSV imports silently fail while the process looks alive. (Telegram
 * is already optional/best-effort per this app's own contract — see
 * src/lib/finance/telegram.ts — so it's not worth failing health over.)
 * Called by apps/telegram-router's check-health cron / /heartbeat command.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    await pool.query("select 1");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
