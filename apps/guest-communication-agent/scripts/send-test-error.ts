/**
 * Throwaway script that sends ONE real test exception to the real Sentry
 * project over the real network, using the real HTTP transport (unlike
 * scripts/verify-sentry.ts, which deliberately stubs the transport as a
 * no-op so it never touches the network — this script is the live-DSN
 * verification step that script's header comment calls out as separate).
 *
 * NOT part of the test suite, NOT meant to stay long-term — just a manual
 * "go check the Sentry dashboard" trigger.
 *
 * Usage: yarn tsx --env-file=.env scripts/send-test-error.ts
 * (needs SENTRY_DSN set in .env — same var src/instrumentation.ts reads)
 *
 * Default import, not `import * as Sentry`: see scripts/verify-sentry.ts's
 * header comment for the full CJS/ESM interop explanation — under tsx,
 * @sentry/nextjs's package.json#exports resolves the "node" (CJS) condition,
 * and Node's CJS/ESM interop only statically detects directly-assigned named
 * exports (like `init`), not `export * from '@sentry/node'` re-exports (like
 * `captureException`/`flush`), which only show up on the default export.
 */

import Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error("[send-test-error] SENTRY_DSN not set — nothing to send. Set it in .env first.");
  process.exit(1);
}

// Real init, no transport override this time — let @sentry/nextjs pick its
// real default HTTP transport so the event actually goes over the network
// to Sentry's servers.
Sentry.init({
  dsn,
  // Same option src/instrumentation.ts uses.
  skipOpenTelemetrySetup: true,
});

const today = new Date().toISOString().slice(0, 10);
const message = `[verify] Manual test exception from send-test-error.ts — safe to ignore/resolve in Sentry, ${today}`;

let eventId: string | undefined;

try {
  throw new Error(message);
} catch (err) {
  eventId = Sentry.captureException(err);
}

console.log(`[send-test-error] Captured event, id: ${eventId}`);
console.log(`[send-test-error] Error message: ${message}`);

const flushed = await Sentry.flush(5000);

console.log(`[send-test-error] Sentry.flush() resolved: ${flushed}`);

if (!flushed) {
  console.error(
    "[send-test-error] FAILED (or timed out) — flush() did not report success within 5000ms. " +
      "The event may not have reached Sentry's servers. Do not assume it arrived.",
  );
  process.exit(1);
}

console.log(
  `[send-test-error] OK — flush() succeeded, event was handed off to Sentry's real HTTP transport. ` +
    `If flush succeeded, this event should appear in the Sentry dashboard within ~30-60 seconds — ` +
    `search by event id "${eventId}" or by the error message text above.`,
);
