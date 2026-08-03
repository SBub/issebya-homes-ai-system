import { DBOS } from "@dbos-inc/dbos-sdk";

// GCA's durable-execution boundary. Per the app owner's explicit scope
// limit, only the missing_info suspend/resume mechanism needs to be real
// DBOS — waitForMissingInfoReply's DBOS.recv (@/agent/tools/missing-info.ts)
// and the resolve route's DBOS.send (also missing-info.ts's
// handleMissingInfoReplyReceived) — plus the workflow registration/start
// plumbing those two depend on (@/agent/run-guest-turn.ts,
// @/app/api/webhook/whatsapp/route.ts). Nothing else in this app's turn
// (model calls, tool dispatch, recordMessage, embedding, ...) is wrapped in
// DBOS.runStep() — fine-grained checkpointing/replay-safety is deliberately
// deferred to later work. A crash mid-turn today may re-run more than the
// ideal minimal amount of work on recovery; that's an accepted, explicit
// tradeoff for this phase, not something this file tries to solve.
//
// SUPABASE_CONNECTION_STRING is a NEW env var, distinct from SUPABASE_URL /
// SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (used everywhere else in
// this app via @supabase/supabase-js's PostgREST client — see
// @/lib/supabase.ts). DBOS needs a raw `postgres://...` connection string
// to create and manage its own system tables (workflow status, step/
// operation outputs, the notification queue DBOS.send/DBOS.recv read and
// write) — Supabase's REST API can't do that, only a real Postgres
// connection can.
//
// To get it: Supabase dashboard -> this project -> Project Settings ->
// Database -> "Connection string" -> URI. Use the same Supabase Postgres
// instance the SUPABASE_* vars already point at, so DBOS's system tables
// live alongside this app's own tables. Prefer the "Session" pooler mode
// (port 5432) over the "Transaction" pooler (port 6543) if Supabase offers
// both for this project — DBOS holds long-lived sessions for its
// notification/wakeup machinery, which transaction-mode pooling can break.
// For local dev against `supabase start`'s local stack, the direct local
// connection string (`postgres://postgres:postgres@127.0.0.1:54332/postgres`
// — check `supabase status`'s "DB URL" for the exact local port) works
// too, since it's a real Postgres connection, not PostgREST.
//
// Lazily launched, not launched at module load: unlike the reference
// project's Express `main()` (harness-engineering/server/index.ts), Next.js
// API routes have no single shared "app startup" hook — any route's module
// can be the first thing to run in a given server process, and every route
// that touches DBOS (the webhook route's DBOS.startWorkflow, the resolve
// route's — via handleMissingInfoReplyReceived — DBOS.send) must be sure
// DBOS.launch() has completed first. ensureDbosLaunched() is memoized so
// the first caller in a process pays the launch cost once; every later
// call/route in the same process reuses the same promise instead of
// re-launching.
//
// HMR safety: `next dev`'s hot-reload can re-evaluate this module (e.g.
// after editing an unrelated file that transitively imports it), re-running
// its top-level statements — including a fresh `let`/module-level binding,
// which would forget any in-flight or completed launch from before the
// reload and attempt a second DBOS.launch() in the same process. DBOS's own
// TypeScript docs describe launch() as callable again only after an
// explicit `shutdown()` in a test context — calling it twice in a live
// process is not documented as safe, so this is a real hazard, not just a
// micro-optimization to avoid. Stashing the launch promise on `globalThis`
// (mirroring the well-known Next.js "singleton Prisma client survives HMR"
// pattern) survives that module re-evaluation, since globalThis itself is
// not reset by HMR within the same server process.
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

/**
 * Ensures DBOS is configured and launched exactly once per server process,
 * regardless of how many routes/callers race to call this concurrently or
 * how many times Next.js re-evaluates this module under HMR. Callers
 * (currently: the webhook route before DBOS.startWorkflow, and the resolve
 * route before handleMissingInfoReplyReceived's DBOS.send) must await this
 * before touching any other DBOS API — calling DBOS.startWorkflow/send/recv
 * before launch() has completed is a DBOS usage error this function cannot
 * paper over.
 */
export function ensureDbosLaunched(): Promise<void> {
  if (!globalThis.__gcaDbosLaunchPromise) {
    globalThis.__gcaDbosLaunchPromise = launchDbos();
  }
  return globalThis.__gcaDbosLaunchPromise;
}
