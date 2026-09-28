# Website: Next.js 16

Guest-facing booking site for issebya.homes. Two rooms, private event space, Stripe checkout, iCal availability sync. Deployed on Vercel.

See `README.md` for the rendering strategy and caching reference tables.

## Project structure

```
src/
├── app/
│   ├── (main)/             # Guest-facing pages
│   │   ├── booking/        # Room booking flow + confirmation (checkout is a
│   │   │                   # Server Action here, actions.ts, not an API route)
│   │   ├── contact/        # WhatsApp contact
│   │   ├── guest-info/     # Arrival, parking, house rules, local tips
│   │   ├── privacy-policy/
│   │   ├── terms-and-conditions/
│   │   └── not-found/
│   ├── api/                # API routes
│   │   ├── availability/   # iCal feed aggregation + own bookings (also called
│   │   │                   # cross-repo by the guest communication agent)
│   │   ├── bookings/       # Direct booking lookup and creation
│   │   ├── webhook/        # Stripe webhook handler
│   │   ├── ical/           # iCal feed export
│   │   └── e2e-ical-mock/  # Mock iCal feed for E2E tests
│   ├── checkin/            # Static, noindex per-guest check-in instructions
│   │                       # (room1/hendrik, room2/{didi,fernando}), shared
│   │                       # CheckinTemplate
│   ├── emails/             # React Email templates
│   └── ui/                 # Shared UI components (Header, Footer, Tabs, ReviewSlider)
├── lib/                    # Utilities (pricing, dates, ical, stripe, analytics, sentry)
│   └── shared/             # Schemas/types shared with other consumers
├── data/                   # Static data (Airbnb reviews)
└── utils/                  # Helpers (image lists)
public/                     # Static assets (room images, dev iCal files)
e2e/                        # Playwright integration tests
app_docs/                   # Internal guides, read before coding (see below)
specs/                      # Feature implementation specifications
scripts/                    # Dev utility scripts (start.ts)
```

## Shop grid error boundary

`/shop` wraps the grid's `<Suspense>` in `ShopGridBoundary` (`shop/ui/`), a
Sentry `ErrorBoundary` inside `ShopControls`' grid wrapper, so a failed page one
shows a short message, a WhatsApp link and "Try again" under a still-usable
search box and sort, while the page header and the sell link keep rendering. Events carry the tags `area: shop` and
`surface: product-grid`.

It is a `"use client"` wrapper because its fallback render prop and
`beforeCapture` are functions, which the server `page.tsx` cannot pass across
the RSC boundary. Retry covers both places page one can fail: `onReset` clears
React Query's error reset boundary (a rejected suspense query would otherwise
re-throw its cached error), and the retry runs `router.refresh()` together with
`resetError()` in one transition (a throw in `ShopProducts` would otherwise
re-render the same errored RSC chunk). Next-page failures never reach it;
`ProductList` keeps its own retry line. There is deliberately no
`shop/error.tsx`: the boundary is scoped to the grid, not the whole segment.

## Shop controls in the static shell

`/shop` has two `<Suspense>` boundaries. The outer one wraps `ShopControls`,
which reads `sort` and `q` from the URL with `useSearchParams` (parsed by the
same `parseShopParams` the server uses, via `shopParamsFromSearch`). In a
prerendered route that makes it render nothing in the shell but its nearest
fallback, so the fallback, `ShopControlsFallback`, is the same search form and
sort select, disabled, around the same grid wrapper and the grid skeleton. The
prerendered HTML therefore already has the controls at their final size, and
the row shares an explicit min height (`SHOP_CONTROLS_ROW_CLASS`, measured: two
lines below a ~500 px viewport, one above). The inner boundary is the list
(`ShopProducts`, which awaits `searchParams`). What depends on page one, the
empty state and the `shop_search_applied` match count, lives in there as
`ShopResults`, and reaches back to `ShopControls` through a context for
`clear` and for the "did the visitor ask for this term" check.

`next dev` does not suspend on `useSearchParams`, so the fallback only ever
shows in a production build; check layout stability with `next start`.

## Testing

| Type              | Files                                                           | What to test                                                                                     |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit              | `src/**/*.unit.test.ts`                                         | Pure functions, API route logic                                                                  |
| Browser component | `src/app/**/*.browser.test.tsx`, `src/ui/**/*.browser.test.tsx` | Client components (`'use client'`) only (mock all children)                                      |
| Integration (E2E) | `e2e/*.integration.spec.ts`                                     | Full flows via Playwright against real Next.js dev server; mock API responses via `page.route()` |

The unit and browser rows gate: `yarn test` runs both, and that is what CI and
the lefthook `pre-push` hook run. The integration row does not gate; it runs
manually and via the ADW test phase.

Config: `vitest.config.ts` (unit + browser projects), `playwright.config.ts` (spins up `yarn dev`).

```bash
yarn test             # vitest unit + browser (chromium), what CI and pre-push run
yarn test:unit        # vitest unit only, watch
yarn test:browser     # vitest browser, all three browsers, watch, manual sweep
yarn test:integration # Playwright E2E, manual / ADW only, not in CI
```

## Environment variables

Local: `apps/website/.env.development` (gitignored), copy from `.env.example`.
Production: Vercel dashboard. Build-time vars must be listed in root `turbo.json` under `env`; runtime-only vars under `passThroughEnv`.

| Variable                            | Type       | Description                                                                |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------- |
| `SUPABASE_URL`                      | runtime    | Supabase project URL                                                       |
| `SUPABASE_ANON_KEY`                 | runtime    | Guest-facing DB queries (RLS-scoped)                                       |
| `SUPABASE_SERVICE_ROLE_KEY`         | runtime    | Server-side admin DB access                                                |
| `STRIPE_SECRET_KEY`                 | runtime    | Checkout session creation                                                  |
| `STRIPE_WEBHOOK_SECRET`             | runtime    | Webhook signature verification                                             |
| `RESEND_API_KEY`                    | runtime    | Transactional emails                                                       |
| `RESEND_FROM_EMAIL`                 | runtime    | Sender address                                                             |
| `ADMIN_NOTIFICATION_EMAIL`          | runtime    | Booking alert recipient                                                    |
| `ROOM1_ICAL_*` / `ROOM2_ICAL_*`     | runtime    | iCal feed URLs (Airbnb, VRBO, Booking.com)                                 |
| `SENTRY_AUTH_TOKEN`                 | build-time | Source map upload at build time (must be in root `turbo.json` build `env`) |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | build-time | PostHog analytics project token                                            |
| `NEXT_PUBLIC_POSTHOG_HOST`          | build-time | PostHog ingestion host                                                     |

`ROOM1_ICAL_*` / `ROOM2_ICAL_*` expand to `_AIRBNB`, `_VRBO` and `_BOOKING`.
Each is optional and an unset one is skipped without an error, which is correct
for Room 1 (it has no VRBO listing) but hides a real misconfiguration: a room
with none of the three set looks exactly the same. `getAvailability` then falls
back to the site's own bookings alone, so OTA reservations for that room stop
blocking the calendar and the pre-checkout re-check has nothing to catch them
with. The only signal is a `No iCal feeds configured for <room>` warning in the
server logs, so check it after changing these.

## Deploy

Vercel, root directory set to `apps/website`. All vars used during build must be declared in root `turbo.json`.

## Further reading

| Guide                                  | What it covers                                             |
| -------------------------------------- | ---------------------------------------------------------- |
| `app_docs/nextjs-patterns-guide.md`    | Server vs client component patterns, data fetching         |
| `app_docs/component-patterns-guide.md` | Component structure and composition rules                  |
| `app_docs/client-form-guide.md`        | Form handling in client components                         |
| `app_docs/zod-validation-guide.md`     | Validation patterns at API boundaries                      |
| `app_docs/data-fetching-client.md`     | Server Component data fetching and Server Action mutations |
| `app_docs/testing/`                    | Unit, browser, and E2E test spec formats and examples      |
| `app_docs/database/`                   | DB interaction rules, production migration process         |
| `app_docs/branding-guidelines.md`      | Colors, typography, tone of voice                          |
| `app_docs/import-patterns-guide.md`    | Import ordering and aliasing conventions                   |
