@AGENTS.md

# Website — Next.js 16

Guest-facing booking site for issebya.homes. Two rooms, private event space, Stripe checkout, iCal availability sync. Deployed on Vercel.

See `README.md` for the rendering strategy and caching reference tables.

## Project structure

```
src/
├── app/
│   ├── (main)/             # Guest-facing pages
│   │   ├── booking/        # Room booking flow + confirmation
│   │   ├── contact/        # WhatsApp contact
│   │   └── guest-info/     # Arrival, parking, house rules, local tips
│   ├── api/                # API routes
│   │   ├── checkout/       # Stripe checkout session creation
│   │   ├── availability/   # iCal feed aggregation + own bookings
│   │   ├── bookings/       # Direct booking lookup
│   │   ├── webhook/        # Stripe webhook handler
│   │   └── ical/           # iCal feed export
│   ├── emails/             # React Email templates
│   └── ui/                 # Shared UI components (Header, Footer, Tabs, ReviewSlider)
├── lib/                    # Utilities (pricing, dates, ical, stripe, analytics, sentry)
├── data/                   # Static data (Airbnb reviews)
└── utils/                  # Helpers (image lists)
public/                     # Static assets (room images, dev iCal files)
e2e/                        # Playwright integration tests
app_docs/                   # Internal guides — read before coding (see below)
specs/                      # Feature implementation specifications
```

## Development guidelines

- TypeScript only, functional components with hooks
- Server components by default — `'use client'` only when the browser must handle state (calendar, gallery swipe, form inputs)
- Next.js `<Image>` for all images
- Zod validation at all API boundaries
- No Radix UI — not installed

## Testing

| Type              | Files                       | What to test                                                                                     |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit              | `src/**/*.unit.test.ts`     | Pure functions, API route logic                                                                  |
| Browser component | `src/**/*.browser.test.tsx` | Client components (`'use client'`) only — mock all children                                      |
| Integration (E2E) | `e2e/*.integration.spec.ts` | Full flows via Playwright against real Next.js dev server; mock API responses via `page.route()` |

Config: `vitest.config.ts` (unit + browser projects), `playwright.config.ts` (spins up `yarn dev`).

```bash
yarn test:unit        # vitest unit
yarn test:browser     # vitest browser (Playwright)
yarn test:integration # Playwright E2E
```

## Environment variables

Local: `apps/website/.env.development` (gitignored) — copy from `.env.example`.
Production: Vercel dashboard. Build-time vars must be listed in root `turbo.json` under `env`; runtime-only vars under `passThroughEnv`.

| Variable                        | Type       | Description                                                                |
| ------------------------------- | ---------- | -------------------------------------------------------------------------- |
| `SUPABASE_URL`                  | runtime    | Supabase project URL                                                       |
| `SUPABASE_ANON_KEY`             | runtime    | Guest-facing DB queries (RLS-scoped)                                       |
| `SUPABASE_SERVICE_ROLE_KEY`     | runtime    | Server-side admin DB access                                                |
| `STRIPE_SECRET_KEY`             | runtime    | Checkout session creation                                                  |
| `STRIPE_WEBHOOK_SECRET`         | runtime    | Webhook signature verification                                             |
| `RESEND_API_KEY`                | runtime    | Transactional emails                                                       |
| `RESEND_FROM_EMAIL`             | runtime    | Sender address                                                             |
| `ADMIN_NOTIFICATION_EMAIL`      | runtime    | Booking alert recipient                                                    |
| `ROOM1_ICAL_*` / `ROOM2_ICAL_*` | runtime    | iCal feed URLs (Airbnb, VRBO, Booking.com)                                 |
| `SENTRY_AUTH_TOKEN`             | build-time | Source map upload at build time (must be in root `turbo.json` build `env`) |

## Deploy

Vercel, root directory set to `apps/website`. All vars used during build must be declared in root `turbo.json`.

## Further reading

| Guide                                  | What it covers                                        |
| -------------------------------------- | ----------------------------------------------------- |
| `app_docs/nextjs-patterns-guide.md`    | Server vs client component patterns, data fetching    |
| `app_docs/component-patterns-guide.md` | Component structure and composition rules             |
| `app_docs/client-form-guide.md`        | Form handling in client components                    |
| `app_docs/zod-validation-guide.md`     | Validation patterns at API boundaries                 |
| `app_docs/data-fetching-client.md`     | Client-side data fetching with React Query            |
| `app_docs/testing/`                    | Unit, browser, and E2E test spec formats and examples |
| `app_docs/database/`                   | DB interaction rules, production migration process    |
| `app_docs/branding-guidelines.md`      | Colors, typography, tone of voice                     |
| `app_docs/import-patterns-guide.md`    | Import ordering and aliasing conventions              |
