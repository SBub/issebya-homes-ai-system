// The PostHog start-up decision. It never imports posthog-js: the client is
// passed in, so this file stays plain and the whole condition is testable in
// node. See app_docs/analytics.md.

// The super property a tagged browser sends with every event; the PostHog
// test-account filter matches on this literal. Never rename or derive it.
const INTERNAL_PROPERTY = "internal";

// The super property an automated browser (Playwright e2e, ADW review) sends
// with every event; the PostHog filter matches on this literal. Never rename
// or derive it.
const AUTOMATED_PROPERTY = "automated";

/** What the `internal` query parameter asks for: tag, untag, or nothing. */
export type InternalTagAction = "tag" | "untag" | null;

/** `?internal=1` tags, `?internal=0` untags, anything else (or nothing) is null. */
export function internalTagAction(search: string): InternalTagAction {
  const value = new URLSearchParams(search).get(INTERNAL_PROPERTY);
  if (value === "1") return "tag";
  if (value === "0") return "untag";
  return null;
}

/** The three public variables instrumentation-client.ts reads literally. */
export interface AnalyticsEnv {
  vercelEnv: string | undefined;
  projectToken: string | undefined;
  host: string | undefined;
}

/** What the browser tells us; undefined when there is no navigator or window. */
export interface AnalyticsBrowser {
  webdriver: boolean | undefined;
  search: string;
}

/**
 * The three PostHog calls start-up needs; an adapter over posthog satisfies
 * it. `onLoaded` runs from posthog-js's `loaded` callback, before the initial
 * `$pageview`, so that pageview already carries the super properties.
 */
export interface AnalyticsClient {
  init(projectToken: string, host: string, onLoaded: () => void): void;
  register(properties: Record<string, true>): void;
  unregister(property: string): void;
}

/**
 * Initialises PostHog only on the production Vercel deploy with both
 * variables set; `NODE_ENV` is "production" on previews too, so it is not the
 * gate. Once loaded, an automated browser (`navigator.webdriver`) is tagged
 * `automated` and `?internal=` tags or untags `internal`. Tagging only adds a
 * super property the PostHog filter hides; it never opts out. Returns whether
 * PostHog was initialised.
 */
export function startAnalytics(
  env: AnalyticsEnv,
  browser: AnalyticsBrowser | undefined,
  client: AnalyticsClient,
): boolean {
  if (env.vercelEnv !== "production" || !env.projectToken || !env.host || browser === undefined) {
    return false;
  }
  client.init(env.projectToken, env.host, () => {
    if (browser.webdriver === true) client.register({ [AUTOMATED_PROPERTY]: true });
    const action = internalTagAction(browser.search);
    if (action === "tag") client.register({ [INTERNAL_PROPERTY]: true });
    if (action === "untag") client.unregister(INTERNAL_PROPERTY);
  });
  return true;
}
