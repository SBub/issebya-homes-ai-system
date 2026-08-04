import { DBOS } from "@dbos-inc/dbos-sdk";

// GCA's durable-execution boundary. Only the missing_info suspend/resume
// (DBOS.recv/send in @/agent/tools/missing-info.ts) is real DBOS; nothing
// else in a turn is wrapped in DBOS.runStep() — fine-grained
// checkpointing/replay-safety is deferred to later work.
//
// SUPABASE_CONNECTION_STRING is a raw postgres:// connection string
// (distinct from the PostgREST-based SUPABASE_* vars in @/lib/supabase.ts)
// DBOS needs to manage its own system tables. From Supabase dashboard ->
// Project Settings -> Database -> Connection string. Prefer "Session"
// pooler mode (port 5432) over "Transaction" mode (6543) — DBOS holds
// long-lived sessions that transaction-mode pooling can break.
//
// Launched lazily and memoized on globalThis (not a module-level `let`) so
// `next dev`'s HMR re-evaluating this module doesn't forget an in-flight
// launch and call DBOS.launch() twice in the same process, which isn't
// documented as safe outside an explicit shutdown() in tests.
declare global {
  // eslint-disable-next-line no-var -- globalThis singleton, see comment above.
  var __gcaDbosLaunchPromise: Promise<void> | undefined;
}

function launchDbos(): Promise<void> {
  const systemDatabaseUrl = process.env.SUPABASE_CONNECTION_STRING;
  if (!systemDatabaseUrl) {
    throw new Error(
      "SUPABASE_CONNECTION_STRING is not set — required to launch DBOS. See src/lib/dbos.ts's top-of-file comment for exactly what to set it to (a raw postgres:// connection string to this project's Supabase Postgres instance, from Supabase dashboard -> Database -> Connection string).",
    );
  }

  DBOS.setConfig({
    name: "guest-communication-agent",
    systemDatabaseUrl,
  });
  return DBOS.launch();
}

// Ensures DBOS is configured and launched exactly once per process. Callers
// must await this before touching any other DBOS API.
export function ensureDbosLaunched(): Promise<void> {
  if (!globalThis.__gcaDbosLaunchPromise) {
    globalThis.__gcaDbosLaunchPromise = launchDbos();
  }
  return globalThis.__gcaDbosLaunchPromise;
}
