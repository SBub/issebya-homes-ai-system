// Alias imports, not relative — works around a known Turbopack bug where
// relative imports to newly-added sibling files fail to resolve in dev (see
// apps/social-media/vitest.config.ts's comment for the full story).
import { pool } from "@/lib/telegram/db";
import { recordDeliveryFailure } from "@/lib/telegram/delivery-failures";
import { checkAllTargets, type HealthCheckResult } from "@/lib/telegram/health-targets";
import { sendMessage, sendWithRetry } from "@/lib/telegram/telegram";

interface HealthState {
  isHealthy: boolean;
  lastStatusChangeAt: Date;
  consecutiveFailures: number;
}

async function getState(service: string): Promise<HealthState | null> {
  const result = await pool.query<{
    is_healthy: boolean;
    last_status_change_at: Date;
    consecutive_failures: number;
  }>(
    "select is_healthy, last_status_change_at, consecutive_failures from health_check_state where service = $1",
    [service],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    isHealthy: row.is_healthy,
    lastStatusChangeAt: row.last_status_change_at,
    consecutiveFailures: row.consecutive_failures,
  };
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function alertText(result: HealthCheckResult, now: Date, downSince: Date): string {
  if (!result.ok) {
    return `🔴 ${result.service} is down\nCheck: ${result.error}\nSince: ${now.toISOString()}`;
  }
  const downtime = formatDuration(now.getTime() - downSince.getTime());
  return `🟢 ${result.service} is back up\nWas down since: ${downSince.toISOString()}\nDowntime: ${downtime}`;
}

/**
 * Persists one service's check result and sends a Telegram alert only on a
 * healthy<->unhealthy transition (§6 of the health-monitor design) — no row
 * yet is treated as "was healthy" so a service's very first check doesn't
 * immediately alert unless it's actually down.
 */
async function processResult(result: HealthCheckResult): Promise<void> {
  const now = new Date();
  const existing = await getState(result.service);
  const wasHealthy = existing?.isHealthy ?? true;
  const transitioned = result.ok !== wasHealthy;
  const statusChangeAt = transitioned ? now : (existing?.lastStatusChangeAt ?? now);
  const consecutiveFailures = result.ok ? 0 : (existing?.consecutiveFailures ?? 0) + 1;

  await pool.query(
    `insert into health_check_state
       (service, is_healthy, last_checked_at, last_status_change_at, last_error, consecutive_failures)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (service) do update set
       is_healthy = excluded.is_healthy,
       last_checked_at = excluded.last_checked_at,
       last_status_change_at = excluded.last_status_change_at,
       last_error = excluded.last_error,
       consecutive_failures = excluded.consecutive_failures`,
    [
      result.service,
      result.ok,
      now,
      statusChangeAt,
      result.ok ? null : (result.error ?? null),
      consecutiveFailures,
    ],
  );

  if (!transitioned) {
    return;
  }

  const text = alertText(result, now, existing?.lastStatusChangeAt ?? now);
  const sendResult = await sendWithRetry(() => sendMessage(text));
  if (!sendResult.ok) {
    await recordDeliveryFailure("health", text, sendResult.error ?? "sendMessage failed");
  }
}

/**
 * Checks every target's liveness, persists state, and alerts on transitions
 * only — shared by the scheduled check-health cron route and the on-demand
 * /heartbeat command. Returns the raw current results either way, so both
 * callers can also report "here's the status right now" regardless of
 * whether anything changed.
 */
export async function runCheckHealth(): Promise<HealthCheckResult[]> {
  const results = await checkAllTargets();
  await Promise.all(results.map(processResult));
  return results;
}
