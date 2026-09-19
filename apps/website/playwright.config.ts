import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load apps/website/.env.development into this process's own `process.env`,
 * mirroring scripts/start.ts's own `loadDevEnv`. `yarn dev:next` (spawned by
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

/**
 * The port the app under test is served on.
 *
 * Defaults to 3000, so a plain `yarn test:integration` on a developer's
 * machine behaves exactly as it always has. When `PORT` is set it follows it,
 * which is how an ADW run gives each worktree its own server instead of
 * sharing 3000 with whatever the developer — or a previous run — happens to
 * have running there. That sharing is not a theoretical problem: a stale
 * server on 3000 started from a different checkout, without this config's
 * `webServer.env`, is silently reused by `reuseExistingServer` below, and the
 * suite then measures the wrong code with the wrong environment.
 *
 * Read after loadDevEnv() so a PORT in .env.development would be honoured
 * too. It must match the port `webServer.command` actually binds: `next dev`
 * reads this same variable, which is why package.json's `dev:next` no longer
 * passes `--port`.
 */
const PORT = process.env.PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  // One worker, deliberately. Tests within a file already run serially, but
  // Playwright runs separate *files* in parallel by default — and every spec
  // here drives the same three pieces of global state: one dev server, one
  // shared local Supabase (see the repo's AGENTS.md), and the process-global
  // `__e2eIcalShouldFail` toggle in src/instrumentation.ts. Two concrete
  // collisions, both observed: the dates-unavailable test in
  // booking-flow.integration.spec.ts seeds a *confirmed* room1 booking for
  // days +10..+13, which is the same room and the same window the booking
  // test in blog-booking-flow.integration.spec.ts tries to book — so it got
  // the conflict message instead of Stripe; and while the iCal-failure test
  // has its toggle on, any concurrent room1 booking elsewhere fails
  // checkAvailability's "unverifiable" gate. Both are artifacts of the
  // scheduling, not of the app. Staggering fixture dates per file would only
  // paper over the first of the two.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
  },
  webServer: {
    command: "yarn dev:next",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    // `dev:next` is `next dev` and nothing else. The heavier `yarn dev`
    // (`tsx scripts/start.ts`) additionally boots local Supabase and a Stripe
    // `stripe listen` forwarder, neither of which any spec here needs — and
    // the way it tore down is worth recording, because it is the reason this
    // is `dev:next` rather than `dev`:
    //
    // Playwright's default teardown is an immediate, uncatchable SIGKILL of
    // the process group it spawned. That never reached scripts/start.ts's own
    // Next.js dev server and Stripe webhook listener child processes: they are
    // deliberately spawned with `detached: true` (so a single Ctrl+C in an
    // interactive terminal triggers start.ts's own orderly cleanup instead of
    // an uncontrolled signal storm hitting every process at once), which puts
    // them in their own, separate OS process group — outside the one
    // Playwright's group-SIGKILL can reach. The result: start.ts's SIGTERM
    // handler (and its cleanup log) never ran, the real dev server and webhook
    // listener were orphaned but kept running (confirmed by hand: `ps` showed
    // them reparented to pid 1, still bound to their port, after a `CI=1`
    // run's teardown), and since they inherited this process's stdout, that
    // pipe never saw EOF either — which is what actually hung the `playwright
    // test` process itself, not just leftover processes.
    //
    // `next dev` is spawned directly here, so it sits inside the process group
    // Playwright signals and that orphaning path is gone. `gracefulShutdown`
    // stays regardless: a SIGKILL'd Next dev server gets no chance to close
    // the in-process MSW server and sockets that instrumentation.ts sets up,
    // and sending a real SIGTERM first (still to the same process group, per
    // Playwright's own docs) lets it shut down cleanly before any fallback
    // SIGKILL.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    env: {
      // Pin the spawned server to the same port `baseURL`/`url` above point
      // at. Playwright merges this map with process.env rather than replacing
      // it, so an inherited PORT would already reach the child — passing it
      // explicitly keeps the two in lockstep regardless.
      PORT,
      // Opt-in-only server-side mocks for the E2E suite, gating real MSW
      // handlers registered from instrumentation.ts. Merged with
      // process.env for the spawned `yarn dev:next` process (not a
      // replacement of it), and have zero effect on plain `yarn dev`/
      // production, where they're unset. See instrumentation.ts and
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
