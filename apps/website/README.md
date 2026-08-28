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
| `/api/checkout/create` | POST       | Creates Stripe Checkout session                                                                                |
| `/api/bookings/direct` | GET / POST | Direct booking lookup and creation                                                                             |
| `/api/webhook/stripe`  | POST       | Handles Stripe events (payment confirmation, email triggers)                                                   |
| `/api/ical/[room]`     | GET        | Exports room bookings as iCal feed                                                                             |

## Rendering strategy

| Page                   | Strategy                                                      | Why                                                     |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Room listing / booking | Partial Prerender (PPR) — static shell + dynamic availability | SEO for room content, real-time availability streams in |
| Booking confirmation   | Server component, server-side fetch                           | No client JS needed, booking data fetched securely      |
| Guest info             | Static (SSG)                                                  | Pure content, no dynamic data                           |
| Contact                | Static (SSG)                                                  | Just a WhatsApp link                                    |
| API routes             | Server-only                                                   | Stripe, Supabase, email — never reach the client        |

`next.config.ts` sets `cacheComponents: true`, so PPR and `"use cache"` are the
Cache Components model in use throughout the app, not the older experimental
PPR flag.

## Caching

| Layer                              | Strategy                                                                                                                                               | TTL                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Booking pages (PPR static shell)   | Build-time prerender — room content, layout                                                                                                            | Indefinite (redeployed on code change)                                                               |
| `/api/availability`                | `"use cache"` directive on the `getAvailability(room)` helper (`cacheLife("hours")`); tagged with `cacheTag("availability", \`availability-${room}\`)` | stale 5m / revalidate 1h / expire 1d, plus on-demand invalidation from `checkout/create` (see below) |
| Static pages (guest-info, contact) | Full SSG — no runtime cache needed                                                                                                                     | Build time                                                                                           |
| All other API routes               | No cache — always fresh                                                                                                                                | —                                                                                                    |

No `unstable_cache`, no `revalidate` headers in use. `/api/availability`
(`src/app/api/availability/route.ts`) is the only route with explicit caching
logic — it replaced a hand-rolled in-memory `Map`/TTL cache (and the old
`?fresh=true` bypass query param) with the native `"use cache"` directive.

On-demand invalidation now happens on the write side instead: when
`/api/checkout/create` (`src/app/api/checkout/create/route.ts`) detects a real
booking conflict (the `dates_unavailable` 409), it calls
`revalidateTag(\`availability-${roomType}\`, { expire: 0 })` right before
returning, so the client's follow-up availability fetch after that error
reads back genuinely fresh data.

**Known limitation:** `revalidateTag` here only invalidates the cache in the
serverless instance that called it, not across all instances — Next.js's
default `"use cache"` handler is in-memory and per-process, and this app has
no custom `cacheHandlers` configured in `next.config.ts`. A retry that lands
on a different instance may briefly see stale data until that instance's own
5-minute stale window (`cacheLife("hours")`) passes on its own. This is not a
correctness risk: the actual conflict check in `checkout/create` queries
Supabase directly, never the cache, so double-booking isn't possible either
way. It's only a possible stale-calendar UX edge case on retry.

## Environment setup

Copy `.env.example` to `.env.development` and fill in values. See `ENGINEERING.md` for the full variable list with descriptions.

```bash
cp .env.example .env.development
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Stripe, Supabase (PostgreSQL), Resend, React Query, date-fns, ical.js, Zod, Sentry.

See `ENGINEERING.md` for the project structure (directory layout, what lives where).
