# @issebya/website

Guest-facing website for [issebya.homes](https://issebya.homes), a guest house in Sintra, Portugal. Guests browse rooms, check availability, and book directly with Stripe payments.

## Features

- Room listings (Room 1, Room 2) with photo gallery and details
- Private event space showcase
- Direct booking with Stripe Checkout (PCI-compliant)
- Real-time availability sync from iCal feeds (Airbnb, VRBO, Booking.com)
- Email confirmations to guests and admin notifications via Resend
- Guest info page (arrival, parking, house rules, local essentials)
- Error tracking via Sentry

## Routes

### Pages

| Route                   | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `/`                     | Home: room listing, reviews                    |
| `/booking`              | Room selection                                 |
| `/booking/[type]`       | Room detail + availability calendar + checkout |
| `/booking/confirmation` | Post-payment confirmation                      |
| `/contact`              | WhatsApp contact link                          |
| `/guest-info`           | Arrival, parking, house rules, local tips      |

### API routes

| Route                  | Method     | What it does                                                                                                   |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `/api/availability`    | GET        | Aggregates iCal feeds (Airbnb, VRBO, Booking.com) + own bookings; cached via `"use cache"` (see Caching below) |
| `/api/bookings/direct` | GET / POST | Direct booking lookup and creation                                                                             |
| `/api/webhook/stripe`  | POST       | Handles Stripe events (payment confirmation, email triggers)                                                   |
| `/api/ical/[room]`     | GET        | Exports room bookings as iCal feed                                                                             |
| `/api/e2e-ical-mock`   | GET        | Mock iCal feed for E2E tests                                                                                   |

Checkout no longer goes through an API route: `submitBooking` (`src/app/(main)/booking/[type]/actions.ts`) is a Server Action that creates the Stripe Checkout session directly, server-side.

## Rendering strategy

| Page                   | Strategy                                                     | Why                                                     |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Room listing / booking | Partial Prerender (PPR): static shell + dynamic availability | SEO for room content, real-time availability streams in |
| Booking confirmation   | Server component, server-side fetch                          | No client JS needed, booking data fetched securely      |
| Guest info             | Static (SSG)                                                 | Pure content, no dynamic data                           |
| Contact                | Static (SSG)                                                 | Just a WhatsApp link                                    |
| API routes             | Server-only                                                  | Stripe, Supabase, email (never reach the client)        |

`next.config.ts` sets `cacheComponents: true`, so PPR and `"use cache"` are the
Cache Components model in use throughout the app, not the older experimental
PPR flag.

## Caching

| Layer                              | Strategy                                                                                                                                                 | TTL                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Booking pages (PPR static shell)   | Build-time prerender: room content, layout                                                                                                               | Indefinite (redeployed on code change)                                                             |
| `/api/availability`                | `"use cache"` directive on the `getAvailability(room)` helper (`cacheLife("minutes")`); tagged with `cacheTag("availability", \`availability-${room}\`)` | stale 5m / revalidate 1m / expire 1h, plus on-demand invalidation from `submitBooking` (see below) |
| Static pages (guest-info, contact) | Full SSG: no runtime cache needed                                                                                                                        | Build time                                                                                         |
| All other API routes               | No cache: always fresh                                                                                                                                   | N/A                                                                                                |

No `unstable_cache`, no `revalidate` headers in use. `/api/availability`
(`src/app/api/availability/route.ts`) is the only route with explicit caching
logic: it replaced a hand-rolled in-memory `Map`/TTL cache (and the old
`?fresh=true` bypass query param) with the native `"use cache"` directive.

The profile is `minutes` rather than `hours` because `hours` revalidates after
an hour but only expires after a day. On a low-traffic site, where nothing
arrives to trigger that revalidation for long stretches, the calendar could
serve day-old availability. `minutes` caps the worst case at an hour.

On-demand invalidation happens on the write side: `submitBooking`
(`src/app/(main)/booking/[type]/actions.ts`) calls
``revalidateTag(`availability-${roomType}`, { expire: 0 })`` as part of its
pre-checkout availability re-check, so that re-check judges the stay against
current feed state rather than a cached snapshot. The fresh `blockedDates`
it returns on a conflict also let the client redraw the calendar without a
separate round trip.

**Known limitation:** `revalidateTag` here only invalidates the cache in the
serverless instance that called it, not across all instances: Next.js's
default `"use cache"` handler is in-memory and per-process, and this app has
no custom `cacheHandlers` configured in `next.config.ts`. A retry that lands
on a different instance may briefly see stale data until that instance's own
5-minute stale window passes on its own. That is a stale-calendar UX edge
case rather than a double-booking risk: the pre-checkout re-check expires the
tag and re-reads within the same invocation, so the picture it judges the
stay against is the one it just refreshed.

## Environment setup

Copy `.env.example` to `.env.development` and fill in values. See `ENGINEERING.md` for the full variable list with descriptions.

```bash
cp .env.example .env.development
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Stripe, Supabase (PostgreSQL), Resend, date-fns, ical.js, Zod, Sentry, PostHog.

See `ENGINEERING.md` for the project structure (directory layout, what lives where).
