import { type NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/telegram/auth";
import { runCheckHealth } from "@/lib/telegram/health-monitor";

/**
 * Whatever real scheduler ends up existing (still an open deployment
 * question, same as check-reminders/check-digest) should call this hourly.
 * Checks each service's liveness (apps/notifications, apps/finance,
 * apps/social-media, apps/orch-a — see health-targets.ts for why
 * apps/telegram-router itself is excluded) and alerts via Telegram only on a
 * healthy<->unhealthy transition, not on every check — see
 * health-monitor.ts. Same underlying check as the on-demand /heartbeat
 * command (see webhook/route.ts) — this is just the scheduled path.
 */
export async function POST(request: NextRequest) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await runCheckHealth();
  return NextResponse.json({ results });
}
