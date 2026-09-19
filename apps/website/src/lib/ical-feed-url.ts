/**
 * Resolves a configured iCal feed value into a URL `fetch` can use.
 *
 * Production feeds are absolute OTA URLs (Airbnb, VRBO, Booking.com) and pass
 * through untouched.
 *
 * Local development and the E2E suite instead point at fixture `.ics` files
 * this very app serves out of `public/dev-ical/`, so their feed URL has to
 * name the port the app is currently listening on. That port is decided per
 * run: `apps/website` honours `PORT` precisely so an ADW run can give each
 * worktree its own server (see the ports section of the repo's AGENTS.md), and
 * playwright.config.ts passes that same `PORT` through to the dev server it
 * spawns. Baking `3000` into `.env.development` pointed every non-3000 run at
 * whatever happened to be on 3000 — usually nothing, so all three room feeds
 * failed, `getAvailability` returned its partial-failure `error`, and every
 * spec that submits a booking broke on a path that has nothing to do with what
 * it tests.
 *
 * Hence: a feed configured as a root-relative path is resolved here, at fetch
 * time, against this process's own `PORT`. Kept in its own dependency-free
 * module because `src/instrumentation.ts` needs it too, and importing
 * `availability.ts` there would drag Sentry and Supabase into the
 * instrumentation graph that Next.js must also be able to build for the edge
 * runtime.
 */
export function resolveIcalFeedUrl(feed: string): string {
  if (!feed.startsWith("/")) return feed;
  return `http://localhost:${process.env.PORT ?? "3000"}${feed}`;
}
