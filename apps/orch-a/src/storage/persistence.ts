import type pg from "pg";

// Expects two tables to exist in the target schema (migration owned by this repo,
// not by the website/finance apps):
//
//   orch_a_runs (id bigserial primary key, ran_at timestamptz not null)
//   orch_a_failed_deliveries (
//       id bigserial primary key, payload jsonb not null,
//       error text not null, created_at timestamptz not null default now()
//   )

export async function recordRun(pool: pg.Pool, ranAt: Date): Promise<void> {
  await pool.query("insert into orch_a_runs (ran_at) values ($1)", [ranAt]);
}

export async function lastRunAt(pool: pg.Pool): Promise<Date | null> {
  const { rows } = await pool.query<{ max: Date | null }>("select max(ran_at) from orch_a_runs");
  return rows[0]?.max ?? null;
}

export async function recordFailedDelivery(
  pool: pg.Pool,
  payload: string,
  error: string,
): Promise<void> {
  await pool.query("insert into orch_a_failed_deliveries (payload, error) values ($1, $2)", [
    payload,
    error,
  ]);
}
