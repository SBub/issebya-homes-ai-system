# Pre-arrival Email Cron

**ADW ID:** 6d199710
**Date:** 2026-09-29
**Specification:** specs/issue-197-adw-6d199710-sdlc_planner-pre-arrival-email-cron.md

## Overview

The booking confirmation email promises every guest an email 48 hours before arrival with the address, parking and check-in arrangements. Until now nothing sent it, so the owner sent it by hand. A daily Vercel Cron now sends it. The route compares database state against a two-day window rather than aiming at an exact moment, and it claims each booking before sending, so a missed run is caught up the next day and a repeated run never emails a guest twice.

## What Was Built

- A nullable `pre_arrival_email_sent_at timestamptz` column on `public.bookings`. Null means the email has not been sent yet.
- A pure selection module that decides which bookings are due: confirmed, not yet emailed, and checking in tomorrow or the day after (UTC calendar days).
- A pure copy module that holds the subject and every sentence of the email once. The HTML template and the plain-text alternative both read from it.
- A React email template, `PreArrivalEmail`, in the same inline style as `BookingConfirmationEmail`.
- `sendPreArrivalEmail` in `resend.ts`. The owner is in `bcc` and `replyTo`.
- A cron route, `GET /api/cron/pre-arrival`. It is protected by a bearer secret, supports a dry run, and returns a `{ sent, skipped, failed }` summary.
- A daily cron entry in `apps/website/vercel.json` (`0 7 * * *`).
- The WhatsApp number and URL moved into `src/lib/site.ts`, where the footer link and the email share them.

## Technical Implementation

### Files Modified

- `supabase/migrations/20260929140000_add_pre_arrival_email_sent_at_to_bookings.sql`: adds the column. RLS, grants and indexes are unchanged, and the `booking_availability` view is unaffected.
- `apps/website/src/lib/bookings/pre-arrival.ts`: `selectPreArrivalCandidates`, `preArrivalWindow`, `firstName`, `maskEmail`.
- `apps/website/src/lib/bookings/pre-arrival-email.ts`: copy constants, line builders, `preArrivalEmailSubject`, `preArrivalEmailText`.
- `apps/website/src/app/emails/PreArrivalEmail.tsx`: the HTML template, which renders the shared copy with map and WhatsApp links.
- `apps/website/src/lib/resend.ts`: `sendPreArrivalEmail`. It throws if `RESEND_FROM_EMAIL` or `ADMIN_NOTIFICATION_EMAIL` is missing, or if Resend returns an `{ error }`.
- `apps/website/src/app/api/cron/pre-arrival/route.ts`: the cron handler (auth, query, classify, claim, send or release).
- `apps/website/src/lib/site.ts`: `WHATSAPP_URL` and `WHATSAPP_DISPLAY_NUMBER`.
- `apps/website/src/app/ui/WhatsAppLink.tsx`: now uses the site constants. Its behaviour is unchanged.
- `apps/website/vercel.json`: the `crons` entry. `ignoreCommand` is kept.
- `apps/website/app_docs/environment-setup.md`, `apps/website/.env.example`: document `CRON_SECRET` and the email variables.
- Root `AGENTS.md`: records that scheduled jobs are Vercel Cron entries and run on production only.

### Key Changes

- **Reconciliation window, not an exact moment.** Hobby cron fires once a day, somewhere within the scheduled hour. It is best effort: a run can be missed or delivered twice, and it is never retried. So the route selects every confirmed booking that has not been emailed yet and checks in on today+1 or today+2. It fetches today+0 as well, but only to log those bookings and report them as skipped with `too_late`; they are never sent.
- **Claim before send.** For each candidate, the route runs `update ... set pre_arrival_email_sent_at = now() where id = $1 and pre_arrival_email_sent_at is null returning id`. If that update matches zero rows, another run already took the booking and it is reported as `already_claimed`. This is what makes two overlapping runs send only once.
- **Release on failure.** If the send fails, the route resets the column to null, reports the error to Sentry with the tag `cron.job: pre-arrival`, and lists the booking under `failed`. The next day's run retries it if it is still in the window.
- **Auth fails closed.** If `CRON_SECRET` is unset, the route returns 500. Any `Authorization` header other than exactly `Bearer ${CRON_SECRET}` gets 401.
- **Copy has a single source.** The subject is fixed as `Your stay at issebya.homes is coming soon`; a review patch restored it after it had drifted to a date-based subject. The body contains the first name, check-in "from 3 pm" with how meeting the host works, check-out "by 11 am", the room, the address with the blue gate and a map link, parking guidance, and WhatsApp contact. It contains no prices, tourist tax, totals or confirmation URL.

## How to Use

1. Set `CRON_SECRET` (random, at least 16 characters, for example `openssl rand -hex 24`) on the website's Vercel project, in the Production environment.
2. Promote `develop` to `master`. The promotion also applies the migration through `migrations.yml`. Crons only run on the production deployment, so this is when the first real run happens.
3. Preview who would be emailed without sending anything:
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://issebya.com/api/cron/pre-arrival?dryRun=1"`
   The response lists the candidates (booking id, check-in, masked email) and any `too_late` skips.
4. Trigger a real run from the Cron Jobs page in the Vercel dashboard ("Run"), or wait for the daily 07:00 to 07:59 UTC run. The owner receives each email as a bcc, and each booking that was emailed has `pre_arrival_email_sent_at` set.
5. To stop a booking from being emailed (for example, one whose email was already sent by hand), set `pre_arrival_email_sent_at = now()` on it in Supabase Studio.

## Configuration

| Variable                   | Purpose                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `CRON_SECRET`              | Bearer secret that Vercel Cron sends. Production only. Required, or the route returns 500. |
| `RESEND_API_KEY`           | Resend API key                                                                      |
| `RESEND_FROM_EMAIL`        | Sender address. The send throws if it is unset.                                     |
| `ADMIN_NOTIFICATION_EMAIL` | Owner address, used as `bcc` and `replyTo`. The send throws, and is retried, if it is unset. |

Schedule: `apps/website/vercel.json` → `crons: [{ path: "/api/cron/pre-arrival", schedule: "0 7 * * *" }]`.

## Testing

- `src/lib/bookings/__tests__/pre-arrival.unit.test.ts`: the selection window, the status and sent filters, the too-late classification, month and year rollover, `firstName`, `maskEmail`.
- `src/lib/bookings/__tests__/pre-arrival-email.unit.test.ts`: the subject, every required line, the `Hello,` fallback, forbidden content (tax, totals, €, the confirmation URL, em dashes), and the rendered HTML.
- `src/lib/__tests__/resend.unit.test.ts`: the payload shape (`bcc`, `replyTo`, `text`, `react`, subject), and throwing on `{ error }` and on a missing owner address.
- `src/app/api/cron/pre-arrival/__tests__/route.unit.test.ts`: auth (401 and 500), the dry run, claim, skip, fail and release, the concurrent send-once case, a DB error, and a check that no email address reaches the logs. These tests run against an in-memory fake of the Supabase query builder.

Run them with `yarn workspace website vitest run --project unit src/lib/bookings src/app/api/cron src/lib/__tests__/resend.unit.test.ts`.

## Notes

- The change also touches `supabase/migrations/` and the root `AGENTS.md`, but most of it is in `apps/website`.
- The spec names the migration `20260929120000_...`. The file that was committed is `20260929140000_add_pre_arrival_email_sent_at_to_bookings.sql`.
- Claiming before sending means a crash between the claim and the Resend call leaves the column set with no email sent. That was accepted as the trade-off for never sending twice, and the owner's bcc makes a missing send visible.
- A send that fails on the last day before check-in is not retried, because by the next run the booking is `too_late`. Sentry already has the failure.
- Logs contain booking ids only, never guest emails or names.
- If promotion lands before 2026-10-01 07:00 UTC, the 2026-10-01 booking (already emailed by hand) will be emailed again unless its column is set first (see How to Use, step 5).
- To add more reminders later, give each message its own column and the same conditional claim.
