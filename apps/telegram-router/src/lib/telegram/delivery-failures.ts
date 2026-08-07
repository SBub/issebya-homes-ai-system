// Alias import, not relative — works around a known Turbopack bug where
// relative imports to newly-added sibling files fail to resolve in dev (see
// apps/social-media/vitest.config.ts's comment for the full story).
import { pool } from "@/lib/telegram/db";

export type DeliverySource = "social";

/**
 * Durable last-resort record for a Telegram send that failed even after a
 * retry, now that this router is the sole Telegram sender for the whole
 * system. Not the primary alerting mechanism (that's a separate
 * observability conversation) — just makes sure a failed send isn't
 * silently lost.
 *
 * Replaces apps/orch-a's old `orch_a_failed_deliveries` table (left in place
 * for its historical data, no longer written to — see
 * supabase/migrations/20260720130000_create_telegram_delivery_failures.sql).
 */
export async function recordDeliveryFailure(
  source: DeliverySource,
  payload: string,
  error: string,
): Promise<void> {
  await pool.query(
    "insert into telegram_delivery_failures (source, payload, error) values ($1, $2, $3)",
    [source, payload, error],
  );
}
