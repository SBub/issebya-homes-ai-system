import type pg from "pg";

// Expects one table to exist in the target schema (migration owned by this repo,
// not by the website/finance apps):
//
//   orch_a_runs (id bigserial primary key, ran_at timestamptz not null)
//
// orch_a_failed_deliveries used to live here too (durable fallback for failed
// Telegram sends) but apps/telegram-router is now the sole Telegram sender for
// the whole system, so that fallback moved to its own shared
// telegram_delivery_failures table, owned by apps/telegram-router. The old
// orch_a_failed_deliveries table is left in place (historical data) but
// nothing writes to it anymore.

export async function recordRun(pool: pg.Pool, ranAt: Date): Promise<void> {
  await pool.query("insert into orch_a_runs (ran_at) values ($1)", [ranAt]);
}

export async function lastRunAt(pool: pg.Pool): Promise<Date | null> {
  const { rows } = await pool.query<{ max: Date | null }>("select max(ran_at) from orch_a_runs");
  return rows[0]?.max ?? null;
}
