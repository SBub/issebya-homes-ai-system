# Analytics (PostHog)

**Specifications:**

- specs/issue-238-adw-5fdec26b-sdlc_planner-production-only-posthog-analytics.md

How `apps/website` sends visitor analytics to PostHog, which events exist, and how the owner's and
automated browsers are kept out of the numbers.

## Production only

PostHog initialises only on the **production Vercel deploy** with both PostHog variables set:

- `NEXT_PUBLIC_VERCEL_ENV === "production"` (a Vercel system variable), and
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` both non-empty.

Anywhere else (local dev, `next build` on a laptop, every Vercel preview, every ADW deploy, the
Playwright e2e run, Vitest) PostHog is silently skipped: no init, no error, no console output.
`NODE_ENV` is **not** the gate: it is `"production"` on every Vercel preview too, which is why the
old `NODE_ENV` check would have sent preview traffic into the experiment's numbers.

When PostHog is not initialised, every `posthog.capture` call in the app is a no-op, so components
call it unconditionally.

The two PostHog variables are set on the Vercel **Production** environment only, from the PostHog
project `ihai-website` (EU). Leave them unset locally and on Preview. See
`environment-setup.md`.

## Start-up module

`src/lib/analytics.ts` holds the whole start-up decision as `startAnalytics(env, browser, client)`.
It never imports posthog-js: `src/instrumentation-client.ts` reads the three `NEXT_PUBLIC_*`
variables literally (Next.js inlines only literal `process.env.NEXT_PUBLIC_*` reads), builds the
browser facts from `navigator` and `window`, and passes a small adapter over `posthog`. That keeps
the condition unit-testable in node (`src/lib/__tests__/analytics.unit.test.ts`). The adapter keeps
the existing init options (`api_host`, `defaults: "2026-01-30"`, `capture_exceptions: true`).

The tags below are applied from posthog-js's `loaded` init callback. In posthog-js 1.422.5,
`_loaded()` calls `config.loaded` first and only then schedules the initial `$pageview` on a
`setTimeout`, so the very first pageview of a session already carries the tags. This matters most
for `automated`, where every session is a fresh browser.

## Internal and automated visitors

Tagged visitors are still captured; they are only filterable. Nothing ever opts out.

| Super property    | Set when                                    | Removed when           |
| ----------------- | ------------------------------------------- | ---------------------- |
| `internal: true`  | a page loads with `?internal=1`             | a page loads with `?internal=0` |
| `automated: true` | `navigator.webdriver === true` (Playwright, ADW review) | never (fresh browser per run) |

`internal` is a persistent super property: it survives reloads and later visits in that browser.
Any other value (`?internal=yes`, `?internal=`, `?INTERNAL=1`) does nothing; with a repeated
parameter the first value wins.

Both property names are literals the PostHog filter matches on. Never rename them.

### Owner's one-time steps

1. Open `https://issebya.homes/?internal=1` once per browser and device, as a full page load
   (type it in the address bar, not a client-side link). `?internal=0` undoes it.
2. In PostHog project settings, set the test-account filter by hand to "event property `internal`
   is not set" and "event property `automated` is not set", then use "Filter out internal and test
   users" on insights.

## Events

Never send email, name, tokens or any free text to PostHog.

| Event                          | Properties                                         | Fired when                                                                                       |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `lockin_waitlist_joined`       | `form` (`short` / `full`), `life_area`, `duration`, `months` | the waitlist action returns `ok` with a non-empty follow-up token (a real join, including a repeat submit of the same email) |
| `lockin_waitlist_reason_added` | `form`                                             | the thank-you step saves a reason for a real join                                               |

`life_area`, `duration` and `months` are sent only when answered (the short form never has them);
an unanswered question is omitted, not sent empty. The honeypot path returns `ok` with an empty
token, and validation or general errors return `ok: false`, so none of them counts as a
conversion. The events are built by the pure helpers in `src/lib/lockin-waitlist/analytics.ts`;
each form wraps its server action in a client function that awaits it and then captures, so there
is exactly one event per submit and no `useEffect`.

Existing events, unchanged by this setup: `room_tab_clicked`, `whatsapp_link_clicked`,
`gallery_image_viewed`, `booking_calendar_opened`, `booking_dates_selected`,
`checkout_session_created`, `shop_products_page_loaded`, `shop_search_applied`,
`shop_sort_changed`, `shop_card_image_changed`, `wishlist_form_opened`, `wishlist_item_added`,
`wishlist_dialog_dismissed`, `seller_submission_created`, and `posthog.captureException` in
`global-error.tsx` (plus automatic exception capture via `capture_exceptions`).

## UTM parameters

posthog-js records `utm_*` parameters on `$pageview` by itself. Never strip query strings from
links to `/lockin-waitlist`, or campaign attribution is lost.
