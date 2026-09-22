// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { captureRouterTransitionStart, init, replayIntegration } from "@sentry/nextjs";
import posthog from "posthog-js";

init({
  // eslint-disable-next-line no-secrets/no-secrets -- Sentry DSN is intentionally public (client-side)
  dsn: "https://443012969c4bd9a2da6f78ad93b1ba75@o4510946424586240.ingest.de.sentry.io/4510946428518480",

  // Add optional integrations for additional features
  integrations: [replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Tag booking flow errors for easier filtering
  beforeSend(event) {
    if (event.contexts?.booking) {
      event.tags = event.tags || {};
      event.tags.flow = "booking";
    }
    return event;
  },
});

export const onRouterTransitionStart = captureRouterTransitionStart;

// This file configures the initialization of PostHog on the client.
// https://posthog.com/docs/libraries/next-js
if (process.env.NODE_ENV === "production") {
  const posthogProjectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (posthogProjectToken && posthogHost) {
    posthog.init(posthogProjectToken, {
      api_host: posthogHost,
      defaults: "2026-01-30",
      capture_exceptions: true,
    });
  }
}
