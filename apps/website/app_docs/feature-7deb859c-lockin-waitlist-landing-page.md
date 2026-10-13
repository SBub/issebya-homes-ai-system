# Lock-in waitlist landing page

**Specifications:**

- specs/issue-235-adw-7deb859c-sdlc_planner-lockin-waitlist-landing-page.md

## Overview

A standalone, chrome-free landing page at `/lockin-waitlist` for visitors arriving from Instagram and TikTok reels. It has one job: collect consented email sign-ups for the lock-in waitlist before dates or prices exist. It is an unreleased blueprint: `noindex, nofollow`, not in the sitemap, linked from nowhere, with no prices, booking or analytics.

## How it works

The page is one mobile-first scroll: hero with a short form, what a lock-in is, why not at home, four "what happens" points, a photo gallery, a host block (visible placeholder text and photo for now), and a full form with optional questions. On a successful submit the form that was submitted is replaced in place by a thank-you panel with one optional follow-up question ("What made you sign up?"). The other form stays.

Sign-ups go to the email-keyed table `lockin_waitlist` (service-role writes only, RLS on, zero policies, `anon`/`authenticated` revoked). A new sign-up or a re-consent gets a plain-text welcome email via Resend with a `List-Unsubscribe` header and an unsubscribe link. Unsubscribing flips consent and never deletes the row.

- `apps/website/src/app/lockin-waitlist/layout.tsx`: pass-through `<main>` layout. The route lives outside `(main)`, so the root layout renders it with no `Header`/`Footer`.
- `apps/website/src/app/lockin-waitlist/page.tsx`: static Server Component with its own `metadata` (robots noindex/nofollow, title, description, OpenGraph and Twitter card using `/og/lockin-waitlist.jpg`, 1200x630). The only anchor on the page is the `/privacy-policy` link inside the consent label.
- `apps/website/src/app/lockin-waitlist/actions.ts`: two Server Actions.
  - `joinLockinWaitlist`: shared by both forms. Zod at the boundary, honeypot (`website` field) first (returns the success shape with no DB write and no email), pre-read of the existing row, pure merge, one `upsert`, welcome email only for new or re-consented rows. An email failure is captured in Sentry and never fails the save. Every submit issues a fresh single-purpose `followup_token`, stored on the row and returned only in that action state.
  - `saveSignupReason`: takes `followupToken` + `signupReason`, updates `signup_reason` on the row whose `followup_token` matches and clears the token in the same update. A missing, malformed or unknown token writes nothing. It never accepts an email.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistShortForm.tsx`, `WaitlistFullForm.tsx`: the two `"use client"` forms (`useActionState`). The submit button is disabled until consent is ticked. Inputs are re-keyed by `state.attempt` and seeded from echoed state so they survive an error submit.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistThankYou.tsx`: thank-you panel and follow-up form.
- `apps/website/src/app/lockin-waitlist/_components/ConsentField.tsx`, `FormParts.tsx`: shared consent checkbox and form building blocks.
- `apps/website/src/app/lockin-waitlist/unsubscribe/route.ts`: resolves the token server-side and 303-redirects to token-free `done`, `already` or `invalid` pages (`invalid` answers 404 via `notFound()`), so the token never reaches the client. Result pages live beside it with `UnsubscribeMessage.tsx`.
- `apps/website/src/lib/lockin-waitlist/copy.ts`: every user-facing string, option list (value + label), the consent sentence stored as `opt_in_copy` (a server constant, never a form value), host placeholder (`LOCKIN_HOST_TEXT`, `LOCKIN_HOST_PHOTO`) and the welcome email subject and body.
- `apps/website/src/lib/lockin-waitlist/schema.ts`: Zod schemas, form-state types, FormData mappers, and `lockinWaitlistUpsert`, the merge rule: an answer is the new value if given, else the existing one, so a short-form resubmit never wipes earlier answers. `signup_reason` is never in the upsert payload.
- `apps/website/src/lib/lockin-waitlist/unsubscribe.ts`: token helpers, `resolveLockinUnsubscribe`, result paths and `scrubLockinUnsubscribeToken`.
- `apps/website/src/lib/resend.ts`: `sendLockinWaitlistWelcomeEmail`, beside the wishlist sender.
- `apps/website/sentry.server.config.ts`: the lock-in scrubber is chained after the wishlist one so the unsubscribe token never reaches Sentry.
- `supabase/migrations/20261013120000_create_lockin_waitlist.sql`: table, enum CHECKs, two-state consent CHECK, `unsubscribe_token` and `followup_token`, `updated_at` trigger, RLS, revoke.
- `apps/website/public/og/lockin-waitlist.jpg`: the share card, center-cropped from `terrace.webp`.

Stored answers are slugs (`health`, `work_business`, `3_days`, `november`), not labels, so a copy tweak never needs a migration.

## How to Use

1. Open `/lockin-waitlist` (share the URL directly; nothing links to it).
2. Enter an email and tick the consent box in the hero form, or fill the full form lower down with optional name, life area, duration and months.
3. Submit. The submitted form is replaced by "You're in." and an optional follow-up question.
4. The welcome email carries an unsubscribe link to `/lockin-waitlist/unsubscribe?token=...`.

To replace the host placeholder, edit `LOCKIN_HOST_TEXT` and `LOCKIN_HOST_PHOTO` in `copy.ts` only.

## Configuration

- `RESEND_FROM_EMAIL` is required for the welcome email; the admin reply-to is used if set.
- The migration must be applied before real sign-ups work. Until then a real submit returns the general error. Locally the owner runs `yarn supabase migration up`, then checks that `set role anon; select * from public.lockin_waitlist;` fails with `permission denied`. Production gets it through the migrations workflow on promotion to `master` (see `app_docs/database/production-migrations.md`).

## Testing

- Unit: `src/lib/lockin-waitlist/__tests__/{copy,schema,unsubscribe}.unit.test.ts` and `src/app/lockin-waitlist/__tests__/actions.unit.test.ts` (Supabase, Resend and Sentry mocked).
- Browser: `_components/WaitlistForms.browser.test.tsx` covers consent gating, inline errors without navigation, the in-place thank-you and the follow-up token.
- Playwright: `e2e/lockin-waitlist.integration.spec.ts` checks the rendered HTML (noindex, JPEG OG card, no `<header`, only the `/privacy-policy` anchor). It needs no DB.
- Without the migration applied, set the hidden `website` honeypot input before submitting to reach the thank-you state with no DB write.

## Notes

- Copy rules: "lock-in" lowercase, brand always `issebya.homes`, no em dashes (enforced by `copy.unit.test.ts`).
- Anyone can submit someone else's email (inherent to email-only forms); that sets fields but cannot wipe them. The follow-up token is returned only to the submitting browser, rotated each submit and cleared on use, so only the latest follow-up writes.
- Two concurrent first submits for one email could send two welcome emails. Accepted.
- The wishlist code in `src/lib/shop/**` was copied as a pattern, not generalised or edited.
- The same change also randomised the WhatsApp number in `e2e/lock-in-flow.integration.spec.ts` so it stops reusing a shared `guest_contacts` row.
