# @issebya/website

Guest-facing website for [issebya.homes](https://issebya.homes) — a guest house in Sintra, Portugal. Guests browse rooms, check availability, and book directly with Stripe payments.

## Features

- Room listings (Room 1, Room 2) with photo gallery and details
- Private event space showcase
- Direct booking with Stripe Checkout (PCI-compliant)
- Real-time availability sync from iCal feeds (Airbnb, VRBO, Booking.com)
- Email confirmations to guests and admin notifications via Resend
- Guest info page (arrival, parking, house rules, local essentials)
- Analytics via Plausible, error tracking via Sentry

## Routes

### Pages

| Route                   | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `/`                     | Home — room listing, reviews                   |
| `/booking`              | Room selection                                 |
| `/booking/[type]`       | Room detail + availability calendar + checkout |
| `/booking/confirmation` | Post-payment confirmation                      |
| `/contact`              | WhatsApp contact link                          |
| `/guest-info`           | Arrival, parking, house rules, local tips      |

### API routes

| Route                  | Method     | What it does                                                                                      |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `/api/availability`    | GET        | Aggregates iCal feeds (Airbnb, VRBO, Booking.com) + own bookings; 1-hour in-memory cache per room |
| `/api/checkout/create` | POST       | Creates Stripe Checkout session                                                                   |
| `/api/bookings/direct` | GET / POST | Direct booking lookup and creation                                                                |
| `/api/webhook/stripe`  | POST       | Handles Stripe events (payment confirmation, email triggers)                                      |
| `/api/ical/[room]`     | GET        | Exports room bookings as iCal feed                                                                |

## Environment setup

Copy `.env.example` to `.env.development` and fill in values. See `CLAUDE.md` for the full variable list with descriptions.

```bash
cp .env.example .env.development
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Stripe, Supabase (PostgreSQL), Resend, React Query, date-fns, ical.js, Zod, Plausible, Sentry.

## Project structure

```
src/
├── app/
│   ├── (main)/             # Guest-facing pages
│   │   ├── booking/        # Room booking flow + confirmation
│   │   ├── contact/        # WhatsApp contact
│   │   ├── guest-info/     # Arrival, parking, house rules, local tips
│   ├── api/                # API routes
│   │   ├── checkout/       # Stripe checkout session creation
│   │   ├── availability/   # iCal feed aggregation + own bookings
│   │   ├── bookings/       # Direct booking lookup and creation
│   │   ├── webhook/        # Stripe webhook handler
│   │   └── ical/           # iCal feed export
│   ├── emails/             # React Email templates
│   └── ui/                 # Shared UI components (Header, Footer, Tabs, ReviewSlider)
├── lib/                    # Utilities (pricing, dates, ical, stripe, analytics, sentry)
├── data/                   # Static data (Airbnb reviews)
└── utils/                  # Helpers (image lists)
public/                     # Static assets (room images, dev iCal files)
e2e/                        # Playwright integration tests
app_docs/                   # Internal guides — patterns, testing, conventions
specs/                      # Feature implementation specifications
scripts/                    # Dev utility scripts (start.py)
```
