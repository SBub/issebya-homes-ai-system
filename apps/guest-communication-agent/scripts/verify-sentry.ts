/**
 * Throwaway verification script for this session's Sentry wiring in
 * src/instrumentation.ts — NOT part of the test suite (vitest never picks
 * this up; it's not under tests/), NOT meant to stay long-term. Confirms
 * `Sentry.init()` + `Sentry.captureException()` + `Sentry.flush()` run
 * end-to-end without throwing, i.e. the plumbing works.
 *
 * Deliberately does NOT send anything to the real DSN / over the network —
 * this session's task was explicit that live Sentry/Axiom verification
 * against real traffic happens separately, later, on purpose. Achieves that
 * by overriding Sentry's `transport` option with a no-op stub instead of
 * using the real HTTP transport `dsn` would otherwise select — the rest of
 * Sentry's event pipeline (client creation, event processing,
 * captureException, envelope building, flush) still runs for real, only the
 * final "make an HTTP request" step is swapped out.
 *
 * Usage: yarn tsx --env-file=.env scripts/verify-sentry.ts
 * (needs SENTRY_DSN set in .env — same var src/instrumentation.ts reads)
 *
 * Default import, not `import * as Sentry`: run directly under tsx/Node
 * (rather than through Next.js's own bundler, which is what actually loads
 * src/instrumentation.ts at runtime), @sentry/nextjs's package.json#exports
 * resolves the "node" condition (its CJS build) ahead of "import" (its ESM
 * build) — Node lists both, in that order, and "node" is always active
 * regardless of `import`/`require` syntax. Node's CJS/ESM interop then only
 * statically detects the CJS module's directly-assigned named exports (e.g.
 * `init`, which src/instrumentation.ts calls); `export * from '@sentry/node'`
 * re-exports like `captureException`/`flush` don't show up as named exports
 * under that interop, only on the `default` object (the real
 * `module.exports`) — verified via `node -e "import('@sentry/nextjs').then(m
 * => console.log(typeof m.captureException, typeof m.default.captureException))"`.
 * This doesn't affect src/instrumentation.ts itself (it only calls
 * `Sentry.init`, which resolves fine either way) — it's specific to this
 * script's plain-tsx execution.
 */

import Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error("[verify-sentry] SENTRY_DSN not set — nothing to verify. Set it in .env first.");
  process.exit(1);
}

let transportSendCalled = false;

Sentry.init({
  dsn,
  // Same option src/instrumentation.ts uses — verifies this script exercises
  // the same code path (Sentry.init() must not touch the global OTel
  // TracerProvider/ContextManager/Propagator here either).
  skipOpenTelemetrySetup: true,
  // No-op transport: proves the event pipeline runs end-to-end (client,
  // event processors, envelope building) without ever making a real network
  // call to Sentry's servers.
  transport: () => ({
    send: async () => {
      transportSendCalled = true;
      return {};
    },
    flush: async () => true,
  }),
});

Sentry.captureException(new Error("verify-sentry: plumbing check"));

const flushed = await Sentry.flush(2000);

console.log(`[verify-sentry] Sentry.flush() resolved: ${flushed}`);
console.log(`[verify-sentry] transport.send() was called: ${transportSendCalled}`);

if (!flushed || !transportSendCalled) {
  console.error(
    "[verify-sentry] FAILED — captureException's event never reached the transport layer",
  );
  process.exit(1);
}

console.log(
  "[verify-sentry] OK — Sentry.init() + captureException() + flush() completed without throwing, " +
    "and without touching the network (no-op transport). Live-DSN verification is a separate, later step.",
);
