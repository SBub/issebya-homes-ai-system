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
- The `E2E` workflow (`.github/workflows/e2e.yml`) runs the chromium `e2e/`
  suite on every PR into `develop`, against a Supabase stack started on the
  runner, with the three `E2E_MOCK_*` mocks from `src/instrumentation.ts` on
  and dummy Stripe/Resend keys. A spec you add under `e2e/` gates PRs into
  `develop` (not pushes, and not the lefthook hook). It is still step 7 of the
  ADW test phase (`.claude/commands/test.md`) and runs manually via
  `yarn workspace website test:integration`.
- If a spec fails only in CI, fix the job's environment, never the spec, and
  never with retries, skips or `continue-on-error`. Never put a real key or a
  `secrets.` reference into that workflow.
- A new browser test now costs every push a few seconds. Keep them
  component-scoped (mock children), as the existing ones are.

## Sentry is production-only

- Server, edge and client Sentry `init` take `enabled` from
  `isSentryEnabled` in `src/lib/sentry-enabled.ts`, which is true only for the
  Vercel `production` environment. Local, e2e (local, ADW, CI) and preview runs
  send nothing. Keep that helper the single decision point.
- Never enable Sentry from `NODE_ENV`: it is `"production"` on previews too.
- The client reports through the same-origin `/monitoring` tunnel
  (`tunnelRoute` in `next.config.ts`), so a check for Sentry traffic must watch
  that path, not just `*.sentry.io`, as `e2e/sentry-disabled.integration.spec.ts`
  does.
