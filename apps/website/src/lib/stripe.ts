import Stripe from "stripe";

// E2E_MOCK_STRIPE (see instrumentation.ts's registerE2EMocks) intercepts
// Stripe's Node SDK calls via an in-process MSW server for the Playwright
// E2E suite. Confirmed by hand (a standalone MSW + stripe-node repro) that
// MSW's FetchInterceptor reliably intercepts Stripe's alternate
// fetch-based HTTP client, but its ClientRequestInterceptor does NOT
// reliably intercept the SDK's *default* NodeHttpClient (raw Node `https`
// module) — that request just hangs against a real network connection
// instead of ever reaching the mock handler. Opting into the fetch-based
// client only under this flag is what makes the E2E mock actually work; it
// has zero effect on the default client used by `yarn dev`/production,
// where this env var is unset.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil",
  ...(process.env.E2E_MOCK_STRIPE === "true" ? { httpClient: Stripe.createFetchHttpClient() } : {}),
});
