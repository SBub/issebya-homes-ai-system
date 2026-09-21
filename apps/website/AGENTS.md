<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

## Development guidelines

- TypeScript only, functional components with hooks
- Server components by default, `'use client'` only when the browser must handle state (calendar, gallery swipe, form inputs)
- Next.js `<Image>` for all images
- Zod validation at all API boundaries
- No Radix UI, not installed

<!-- END:nextjs-agent-rules -->

## Calendar days are strings, not `Date`s

A calendar day is a label, not an instant. Check-in and check-out travel as
`"yyyy-MM-dd"` strings across every browser/server boundary: Server Action
arguments, Server Component props, URL query params, Stripe metadata, and the
date-only Postgres columns. They become a `Date` only inside code doing date
arithmetic.

- Convert with `toCalendarDay` / `fromCalendarDay` (`src/lib/date-utils.ts`),
  which are the single place that conversion is defined. Don't format or parse
  a calendar day inline anywhere else.
- Never parse a date-only string with bare `new Date("2026-09-21")`. That is
  UTC midnight, while `startOfDay`, `isDateBlocked` and ical.js all anchor on
  local midnight, so the comparison silently shifts by a day off UTC.
- Never hand a `Date` the browser built to the server and format it there. The
  server re-reads it in its own timezone (UTC on Vercel) and records the
  previous day for every guest ahead of UTC.

## Availability and the calendar

- The pre-checkout re-check in `submitBooking` must stay in agreement with the
  calendar UI: both classify dates with `mergeDateRanges` plus
  `isValidDateRange` over the merged calendar (iCal feeds and own bookings).
  Checking own bookings alone is what previously allowed OTA double bookings.
- In `BookingCalendar`'s `getDateClasses`, appearance and clickability are
  deliberately separate concerns. A blocked day must never receive
  `calendar-date-available`; it renders as selected, check-out boundary
  (hatched) or unavailable. Change one without the other only on purpose.

## Which test layers gate, and which don't

- `yarn turbo run test` for this workspace runs **both** Vitest projects, `unit`
  and `browser`. CI runs it and so does the lefthook `pre-push` hook, so a
  `*.browser.test.tsx` you add is a real regression gate from the moment it
  lands.
- The gated browser run is chromium only. `yarn workspace website test:browser`
  runs the full chromium/firefox/webkit sweep and is manual. Webkit cannot
  launch on macOS 14 arm64 (Playwright ships a frozen build for that platform),
  so expect the sweep to fail there on webkit alone.
- The Playwright `e2e/` suite is **deliberately not in CI**. It needs a running
  dev server on this run's port, the shared local Supabase, `.env.development`
  and the `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` in-process mocks from
  `src/instrumentation.ts`, none of which exist in the CI image. It runs
  manually via `yarn workspace website test:integration` and automatically as
  step 7 of the ADW test phase (`.claude/commands/test.md`). A spec you add
  under `e2e/` will not re-run in CI; put anything that must gate into a
  `*.unit.test.ts` or a `*.browser.test.tsx` instead.
- A new browser test now costs every push a few seconds. Keep them
  component-scoped (mock children), as the existing ones are.
