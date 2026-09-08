import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load apps/website/.env.development into this process's own `process.env`,
 * mirroring scripts/start.ts's own `loadDevEnv`. `yarn dev` (spawned by
 * `webServer` below) loads `.env.development` itself, but only inside that
 * child process — this test-runner process needs its own copy of
 * `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` so spec files can seed/clean up
 * fixtures directly via `createAdminClient()` (see the dates-unavailable test
 * in e2e/booking-flow.integration.spec.ts).
 */
function loadDevEnv(): void {
  const envPath = path.join(PROJECT_ROOT, ".env.development");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

loadDevEnv();

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: {
    command: "yarn dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    // Without this, Playwright's default teardown is an immediate, uncatchable
    // SIGKILL of the process group it spawned (`yarn dev` -> `tsx
    // scripts/start.ts`). That never reaches scripts/start.ts's own Next.js
    // dev server and Stripe webhook listener child processes: they're
    // deliberately spawned with `detached: true` (so a single Ctrl+C in an
    // interactive terminal triggers start.ts's own orderly cleanup instead of
    // an uncontrolled signal storm hitting every process at once), which
    // puts them in their own, separate OS process group — outside the one
    // Playwright's group-SIGKILL can reach. The result: start.ts's SIGTERM
    // handler (and its cleanup log) never runs, the real dev server and
    // webhook listener are orphaned but keep running (confirmed by hand:
    // `ps` shows them reparented to pid 1, still bound to port 3000, after a
    // CI=1 run's teardown), and since they inherited this process's stdout,
    // that pipe never sees EOF either — which is what actually hangs the
    // `playwright test` process itself, not just leftover processes. Sending
    // a real SIGTERM first (still to the same process group, per Playwright's
    // own docs) gives start.ts's existing signal handler a chance to run its
    // graceful shutdown before any fallback SIGKILL.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    env: {
      // Opt-in-only server-side mocks for the E2E suite, gating real MSW
      // handlers registered from instrumentation.ts. Merged with
      // process.env for the spawned `yarn dev` process (not a replacement of
      // it), and have zero effect on plain `yarn dev`/production, where
      // they're unset. See instrumentation.ts and
      // e2e/booking-flow.integration.spec.ts.
      E2E_MOCK_STRIPE: "true",
      E2E_MOCK_ICAL_FAILURE: "true",
    },
  },
  projects: process.env.CI
    ? [{ name: "chromium", use: { browserName: "chromium" } }]
    : [
        { name: "chromium", use: { browserName: "chromium" } },
        { name: "firefox", use: { browserName: "firefox" } },
        { name: "webkit", use: { browserName: "webkit" } },
      ],
});
