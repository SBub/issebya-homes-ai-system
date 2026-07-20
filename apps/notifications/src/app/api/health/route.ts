import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/notifications/auth";
import { pool } from "@/lib/notifications/db";

/**
 * Deep liveness check — Postgres is this app's only dependency and its
 * entire reason to exist (getDueReminders/acknowledgeReminder/recordSent are
 * all it does). If Postgres is unreachable the process stays up and answers
 * HTTP fine, but every reminder silently stops firing — a shallow check
 * would miss exactly the failure mode that matters most here. Called by
 * apps/telegram-router's check-health cron / /heartbeat command.
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
