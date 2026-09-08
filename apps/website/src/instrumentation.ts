import { captureRequestError } from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    await registerE2EMocks();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Starts an in-process MSW server so the Playwright E2E suite
 * (e2e/booking-flow.integration.spec.ts) can deterministically mock
 * server-side network calls that happen inside this Next.js server process
 * itself — invisible to Playwright's browser-level `page.route()` — without
 * ever touching real Stripe/iCal infrastructure.
 *
 * Strictly opt-in via two env vars, both set only in playwright.config.ts's
 * `webServer.env` for the Playwright-spawned server: unset (the default for
 * `yarn dev` and production), this is a no-op with zero behavior change.
 *
 * - `E2E_MOCK_STRIPE`: mocks `POST https://api.stripe.com/v1/checkout/sessions`
 *   (the only Stripe call `submitBooking` makes — see
 *   src/app/(main)/booking/[type]/actions.ts) with a fake successful session.
 *   Active for every request once the server is up (there's only one Stripe
 *   call site, and no other test in the suite triggers it, so there's no
 *   cross-test interaction to worry about).
 * - `E2E_MOCK_ICAL_FAILURE`: registers (but does not unconditionally trigger)
 *   a mock that fails the room1 `ROOM1_ICAL_AIRBNB` feed request, so
 *   `getAvailability`'s partial-failure error path (src/lib/availability.ts)
 *   is deterministically reachable. Unlike the Stripe mock, this can't be
 *   left "always on" for the whole run: the resulting non-fatal `error`
 *   string is present on every booking page load, and one other test
 *   (dates_unavailable) depends on the booking form staying visible after a
 *   real conflict — an ambient ical error combined with that flow's
 *   post-conflict `checkInDate === null` trips BookingClient.tsx's
 *   `if (error && !checkInDate)` early return, replacing the whole booking
 *   engine (and the dates_unavailable message inside it) with just the raw
 *   ical error text. So the handler is always registered when this flag is
 *   set, but only actually fails the request when
 *   `globalThis.__e2eIcalShouldFail` is true — toggled at runtime by the
 *   E2E-only POST /api/e2e-ical-mock route (src/app/api/e2e-ical-mock/
 *   route.ts), which the "some iCal feeds fail" test flips on immediately
 *   before its navigation and back off in a `finally`. Everywhere else it's
 *   a passthrough to the real feed URL. That route also busts
 *   `getAvailability`'s "use cache" tag for room1 on every toggle — without
 *   that, the toggle has no visible effect, since `generateStaticParams` on
 *   the booking page triggers one background prewarm call to
 *   `getAvailability` shortly after the dev server boots (before this flag
 *   is ever set), and that result then serves every later navigation for
 *   the rest of the cache's lifetime.
 */
async function registerE2EMocks(): Promise<void> {
  const mockStripe = process.env.E2E_MOCK_STRIPE === "true";
  const mockIcalFailure = process.env.E2E_MOCK_ICAL_FAILURE === "true";

  if (!mockStripe && !mockIcalFailure) return;

  // webpackIgnore skips bundling this dynamic import entirely (supported by
  // both webpack and Turbopack per next.config.js's turbopack docs) — without
  // it, Next.js's dev bundler also tries to build msw/node into the *Edge*
  // Instrumentation graph (it must be able to build every runtime target
  // register() could be called from, even though this branch only ever runs
  // under NEXT_RUNTIME === "nodejs"), and msw/node's Node-only
  // @mswjs/interceptors/* subpath exports don't resolve under the edge
  // condition set, hard-failing the entire dev server with a 500 on every
  // route. Left as a real runtime import, Node resolves it normally.
  //
  // Deliberately importing the (deprecated but still fully public and typed)
  // `SetupServerApi` class instead of the plain `setupServer()` factory: the
  // factory hardcodes all four of msw's built-in interceptors (ClientRequest,
  // XMLHttpRequest, Fetch, WebSocket), but `SetupServerApi`'s constructor
  // lets us choose exactly which ones run. We only ever need
  // `FetchInterceptor` — both mocked calls (Stripe via
  // `Stripe.createFetchHttpClient()`, iCal via `fetch()` in
  // src/lib/ical-parser.ts) go through the global `fetch`, never through
  // Node's legacy `http`/`https` module.
  //
  // This isn't just "the minimal set" — it sidesteps a real upstream bug.
  // `ClientRequestInterceptor` (which we'd otherwise get for free from
  // `setupServer()`) proxies *every* outgoing `http`/`https` call in the
  // process, including ones no handler here matches (e.g. Sentry's envelope
  // transport), through its `MockHttpSocket.passthrough()` machinery even
  // when `onUnhandledRequest: "bypass"` just wants it to hit the real
  // network untouched. That passthrough aliases the mock socket's `_handle`
  // to the real one it opens, and under Node's Happy-Eyeballs dual-stack
  // connect racing (or, for HTTPS, a narrower OpenSSL-state race even
  // without Happy Eyeballs) the real handle can be swapped out or torn down
  // while msw still holds a reference to it — surfacing as an uncatchable
  // `uncaughtException: Error: write ECANCELED Canceled because of SSL
  // destruction` (confirmed against this exact msw/@mswjs/interceptors
  // version: reproduced locally, matches https://github.com/mswjs/
  // interceptors/issues/753, fixed upstream in @mswjs/interceptors 0.42.0's
  // rewrite — but msw 2.15.0, the latest published version as of writing,
  // still pins `@mswjs/interceptors@^0.41.3` and hasn't picked up that
  // rewrite yet, so a version bump alone can't pull the fix in). Once that
  // exception fires, the corrupted handle never emits `close`, so the dev
  // server's own graceful shutdown on SIGTERM (triggered by Playwright's
  // `webServer` teardown after the suite passes) blocks forever waiting for
  // it to drain, hanging the whole `yarn dev` process tree.
  //
  // `ClientRequestInterceptor`/`XMLHttpRequestInterceptor` never installing
  // at all means `MockHttpSocket.passthrough()` never runs for *any*
  // real request in this process (not just the ones our handlers ignore),
  // so this bug class can't trigger here regardless of what real network
  // calls the server makes. `WebSocketInterceptor` is dropped too since
  // nothing here mocks WebSocket traffic.
  const { SetupServerApi } = await import(/* webpackIgnore: true */ "msw/node");
  const { http, HttpResponse, passthrough } = await import(/* webpackIgnore: true */ "msw");
  const { FetchInterceptor } = await import(/* webpackIgnore: true */ "@mswjs/interceptors/fetch");

  const handlers: ConstructorParameters<typeof SetupServerApi>[0] = [];

  if (mockStripe) {
    handlers.push(
      http.post("https://api.stripe.com/v1/checkout/sessions", () =>
        HttpResponse.json({
          id: `cs_test_e2e_${crypto.randomUUID()}`,
          url: "https://checkout.stripe.com/c/pay/test_e2e_session",
        }),
      ),
    );
  }

  if (mockIcalFailure && process.env.ROOM1_ICAL_AIRBNB) {
    handlers.push(
      http.get(process.env.ROOM1_ICAL_AIRBNB, () =>
        (globalThis as { __e2eIcalShouldFail?: boolean }).__e2eIcalShouldFail
          ? HttpResponse.error()
          : passthrough(),
      ),
    );
  }

  // onUnhandledRequest: "bypass" — only Stripe/the targeted iCal feed above
  // are intercepted; real Supabase traffic and everything else passes
  // through untouched.
  new SetupServerApi(handlers, [new FetchInterceptor()]).listen({
    onUnhandledRequest: "bypass",
  });
}

export const onRequestError = captureRequestError;
