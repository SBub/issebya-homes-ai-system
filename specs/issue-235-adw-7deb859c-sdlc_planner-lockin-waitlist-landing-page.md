# Feature: lock-in waitlist landing page at /lockin-waitlist (unreleased blueprint)

## Metadata

issue_number: `235`
adw_id: `7deb859c`
issue_json: `{"number":235,"title":"feat(website): lock-in waitlist landing page at /lockin-waitlist (unreleased blueprint)"}`

## Feature Description

A standalone, chrome-free landing page at `/lockin-waitlist` in `apps/website`. Visitors arrive from
Instagram and TikTok reels. It has one job: get them onto the lock-in waitlist. It is a single
mobile-first scroll: hero with a short form, "what a lock-in is", "why not at home", four "what
happens" points, a photo gallery of the house, a host block (placeholder text and photo for now),
and a full form with optional questions. On a successful submit the form that was submitted is
replaced in place by a thank-you panel with one optional follow-up question.

Sign-ups go to a new email-keyed table `lockin_waitlist` (service-role writes only, RLS on, zero
policies), modelled on `shop_wishlist_contacts`. A new sign-up or a re-consent gets a plain-text
welcome email via Resend with an unsubscribe link to `/lockin-waitlist/unsubscribe?token=...`,
which flips consent and never deletes the row.

The page is a **blueprint**: `noindex, nofollow`, not in the sitemap, linked from nowhere. No
prices, booking, analytics or changes to `/lock-in/*`.

## User Story

As a person who saw a lock-in reel on Instagram or TikTok
I want to leave my email (and, if I like, what I'd work on and when) in a few seconds on my phone
So that I'm the first to hear when lock-in dates open, without being sold to

## Problem Statement

Reels drive interest in lock-ins before dates or prices exist. There is no place to capture that
interest: `/lock-in/[type]` (#232) is a booking page with prices, and the shop wishlist is tied to
products. Without a focused, consented, email-keyed list the owner can't gauge demand, learn which
life areas and months people want, or tell them when dates open.

## Solution Statement

- A new route segment `src/app/lockin-waitlist/` **outside** the `(main)` route group (like
  `src/app/checkin/`), so the root layout renders it with no `Header`/`Footer`. The page is a
  Server Component with its own `metadata` (robots noindex/nofollow, title, description,
  `openGraph`/`twitter` with a 1200×630 JPEG). Only the two forms are client components.
- All copy, option lists and email text live in one module, `src/lib/lockin-waitlist/copy.ts`.
  Zod schemas, form-state types, FormData mapping and the merge rule live in
  `src/lib/lockin-waitlist/schema.ts`. Token helpers and the unsubscribe resolver live in
  `src/lib/lockin-waitlist/unsubscribe.ts`. All three are node-pool testable (no `"use server"`,
  no Next imports), exactly like `src/lib/shop/wishlist.ts` / `src/lib/shop/unsubscribe.ts`.
- Two Server Actions in `src/app/lockin-waitlist/actions.ts`:
  - `joinLockinWaitlist(prevState, formData)`: shared by both forms. Zod at the boundary, honeypot
    first (success shape, no DB, no email), pre-read of the existing row, a pure merge
    (`lockinWaitlistUpsert`) that never wipes earlier answers with empty ones and handles
    re-consent, one `upsert` with the service role, welcome email only for new or re-consented
    rows, email failure captured in Sentry and never failing the save. Every submit issues a fresh
    single-purpose `followup_token`, stored on the row and returned **only** in that action state.
  - `saveSignupReason(prevState, formData)`: takes `followupToken` + `signupReason`, updates
    `signup_reason` on the row whose `followup_token` matches and clears the token in the same
    update. A missing, malformed or unknown token writes nothing. It never accepts an email.
- Unsubscribe: Route Handler `src/app/lockin-waitlist/unsubscribe/route.ts` that resolves the token
  server-side and 303-redirects to token-free `done` / `already` / `invalid` pages (invalid answers
  404 via `notFound()`), the same reasoning as the wishlist route (`cacheComponents` +
  `searchParams` would otherwise stream a 200 and leak the token client-side).
- Sentry: a lock-in copy of the token scrubber, chained after the wishlist one in
  `sentry.server.config.ts`, so the new unsubscribe URL's token never reaches Sentry. The wishlist
  module itself is not edited (issue: copy patterns, don't generalise).
- Migration `supabase/migrations/20261013120000_create_lockin_waitlist.sql`, additive only.

## Relevant Files

Use these files to implement the feature:

- `README.md`, `AGENTS.md` - repo conventions (yarn only, conventional commits, never reset Supabase).
- `apps/website/AGENTS.md` - read `node_modules/next/dist/docs/` before route work, Server
  Components by default, `next/image`, Zod at boundaries, no Radix; which test layers gate.
- `docs/conditional-docs.md` - matched entries listed below.
- `apps/website/app_docs/client-form-guide.md` - `useActionState` pattern for both forms.
- `apps/website/app_docs/form-re-render-strategy.md` - uncontrolled inputs reset on action submit;
  re-key/re-seed from echoed state (as `WishlistFormState.email` does).
- `apps/website/app_docs/zod-validation-guide.md` - Zod at the Server Action boundary.
- `apps/website/app_docs/database/database-interaction-rules.md` - read before writing the
  migration. (Its `supabase:reset` advice does NOT apply here: Protected section forbids it.)
- `apps/website/app_docs/database/production-migrations.md` - how the migration reaches prod.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`,
  `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md`,
  `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md` - the consent, email and
  unsubscribe design being copied (token rotation, `List-Unsubscribe`, Sentry scrubbing).
- `apps/website/app_docs/feature-f72316fa-booking-og-metadata.md` - OG image shape, why metadata
  replaces the root's wholesale, and the WhatsApp-UA Playwright check being reused.
- `apps/website/app_docs/branding-guidelines.md` - colours, type, tone for the page styling.
- `apps/website/app_docs/testing/unit_test_spec_format.md`,
  `apps/website/app_docs/testing/component_test_spec_format.md`,
  `apps/website/app_docs/testing/e2e_example.md` - test formats.
- `supabase/migrations/20260924120000_create_shop_wishlist.sql`,
  `supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql` - table, consent-state
  CHECK, token default (`extensions.gen_random_bytes`), `updated_at` trigger, RLS + revoke.
- `apps/website/src/lib/shop/wishlist.ts` - copy-module + schema + `wishlistContactUpsert` +
  `wishlistInputFromFormData` + form-state pattern. Read only; do not edit.
- `apps/website/src/lib/shop/unsubscribe.ts` - token format, `resolveUnsubscribe`,
  `unsubscribeResultPath`, `scrubUnsubscribeToken`. Read only; do not edit.
- `apps/website/src/app/(main)/shop/[slug]/actions.ts` - Server Action structure (honeypot first,
  `startSpan`, pre-read, upsert, email in try/catch with `captureException`). Read only.
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` - Supabase/Resend/Sentry
  mocking pattern for the action test.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` and
  `WishlistDialog.browser.test.tsx` - client form + browser-test pattern (mocking `../actions`).
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/**` - route handler + result pages.
- `apps/website/src/app/checkin/layout.tsx` - a route outside `(main)`, no chrome.
- `apps/website/src/app/(main)/booking/[type]/page.tsx` - OG/Twitter image object shape.
- `apps/website/src/app/layout.tsx` - root metadata that the page must replace wholesale.
- `apps/website/src/lib/resend.ts` - add `sendLockinWaitlistWelcomeEmail` beside
  `sendWishlistConfirmationEmail` (same shape, throws on Resend `{ error }`).
- `apps/website/src/lib/shared/schemas/email.ts` - shared normalising `emailSchema`.
- `apps/website/src/lib/shared/validation.ts` - `formatZodErrors`.
- `apps/website/src/lib/shared/supabase.ts` - `createAdminClient()`.
- `apps/website/src/lib/site.ts` - `SITE_URL` for the unsubscribe URL.
- `apps/website/sentry.server.config.ts` - chain the new scrubber.
- `apps/website/e2e/booking-og-metadata.integration.spec.ts` - model for the metadata spec.
- `knip.json` - website entry/project globs already cover new files; every new export must be used.
- `apps/website/public/` - source photos (`terrace.webp`, `bedroom.webp`, `living_room.webp`,
  `kitchen_living_room.webp`, `frontyard.webp`, `living_room_puff.webp`).

Must stay untouched: `src/app/(main)/lock-in/**`, `src/app/(main)/booking/**`, `src/app/ui/Header*`,
`src/app/ui/Footer*`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/lib/shop/**`, every
`shop_wishlist_*` migration, `guest_contacts`.

### New Files

- `supabase/migrations/20261013120000_create_lockin_waitlist.sql` - table, checks, trigger, RLS, revoke.
- `apps/website/src/lib/lockin-waitlist/copy.ts` - every user-facing string, option lists
  (value + label), consent sentence, host placeholder, email subject/body builder.
- `apps/website/src/lib/lockin-waitlist/schema.ts` - Zod schemas, form-state types and initial
  states, FormData mappers, `lockinWaitlistUpsert` merge.
- `apps/website/src/lib/lockin-waitlist/unsubscribe.ts` - `newLockinToken`, `isLockinToken`,
  `lockinUnsubscribeUrl`, `resolveLockinUnsubscribe`, `lockinUnsubscribeResultPath`,
  `scrubLockinUnsubscribeToken`.
- `apps/website/src/lib/lockin-waitlist/__tests__/copy.unit.test.ts`
- `apps/website/src/lib/lockin-waitlist/__tests__/schema.unit.test.ts`
- `apps/website/src/lib/lockin-waitlist/__tests__/unsubscribe.unit.test.ts`
- `apps/website/src/app/lockin-waitlist/layout.tsx` - pass-through layout (`<main>` wrapper).
- `apps/website/src/app/lockin-waitlist/page.tsx` - Server Component page + `metadata`.
- `apps/website/src/app/lockin-waitlist/actions.ts` - `"use server"`: `joinLockinWaitlist`, `saveSignupReason`.
- `apps/website/src/app/lockin-waitlist/__tests__/actions.unit.test.ts`
- `apps/website/src/app/lockin-waitlist/_components/WaitlistShortForm.tsx` - `"use client"`.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistFullForm.tsx` - `"use client"`.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistThankYou.tsx` - thank-you panel with
  the follow-up form (rendered only inside the two client forms, so no directive of its own).
- `apps/website/src/app/lockin-waitlist/_components/ConsentField.tsx` - shared checkbox + label +
  `/privacy-policy` link + inline error (data-only difference between the two forms).
- `apps/website/src/app/lockin-waitlist/_components/WaitlistForms.browser.test.tsx`
- `apps/website/src/app/lockin-waitlist/unsubscribe/route.ts`
- `apps/website/src/app/lockin-waitlist/unsubscribe/done/page.tsx`
- `apps/website/src/app/lockin-waitlist/unsubscribe/already/page.tsx`
- `apps/website/src/app/lockin-waitlist/unsubscribe/invalid/page.tsx` + `not-found.tsx`
- `apps/website/src/app/lockin-waitlist/unsubscribe/_components/UnsubscribeMessage.tsx`
- `apps/website/public/og/lockin-waitlist.jpg` - 1200×630 JPEG, center-cropped from `terrace.webp`, < 300 KB.
- `apps/website/e2e/lockin-waitlist.integration.spec.ts` - rendered-HTML metadata/chrome check.

## Implementation Plan

### Phase 1: Foundation

Migration, copy module, schema + merge, token/unsubscribe helpers, OG image. All pure and
unit-tested before any UI exists.

### Phase 2: Core Implementation

Server Actions, welcome email sender, unsubscribe route + result pages, Sentry scrubber chain.

### Phase 3: Integration

Page, layout, the two client forms and thank-you panel, browser test, Playwright metadata spec,
review screenshots, full validation.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs

- Read `apps/website/AGENTS.md` and the relevant files in `node_modules/next/dist/docs/` (App
  Router: layouts and route groups, `metadata`/`generateMetadata` incl. `robots` and `openGraph`,
  Server Actions + `useActionState`, Route Handlers, `notFound`, `next/image`, `cacheComponents`).
- Read every doc listed under Relevant Files.

### 2. Migration `supabase/migrations/20261013120000_create_lockin_waitlist.sql`

- Header comment in the style of the wishlist migrations: why the table exists, who writes it
  (service role via the website Server Actions only), who reads it (owner in Studio, CSV export),
  why `guest_contacts` is not used (phone-keyed), the two consent states, the two tokens and what
  each is for.
- Columns:
  - `email text primary key`, `constraint lockin_waitlist_email_normalised check (email = lower(btrim(email)))`
  - `name text null` (`check (name is null or char_length(name) between 1 and 100)`)
  - `life_area text null check (life_area in ('work_business','relationships','health','creative_project','other'))`
  - `duration text null check (duration in ('weekend','3_days','7_days'))`
  - `months text[] null check (months is null or (cardinality(months) > 0 and months <@ array['november','december','january','later']::text[]))`
  - `signup_reason text null check (signup_reason is null or char_length(signup_reason) between 1 and 1000)`
  - `marketing_opt_in boolean not null`, `opted_in_at timestamptz not null`, `opt_in_copy text not null`
  - `unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex')`
  - `unsubscribed_at timestamptz null`
  - `followup_token text null unique` (single-purpose, for the thank-you answer; rotated every
    submit, cleared once used)
  - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
  - `constraint lockin_waitlist_consent_state check ((marketing_opt_in and unsubscribed_at is null) or (not marketing_opt_in and unsubscribed_at is not null))`
- `alter table public.lockin_waitlist enable row level security;` with **no** policies;
  `revoke all on public.lockin_waitlist from anon, authenticated;`
- `update_lockin_waitlist_updated_at()` function (`clock_timestamp()`) + `before update` trigger.
- Do **not** apply it (Protected: no migration on the shared instance in an ADW run). See Notes for
  the owner's apply + `anon` check.

### 3. Copy module `src/lib/lockin-waitlist/copy.ts`

- File doc comment like `wishlist.ts`. Imports nothing but types.
- Constants, verbatim from the issue: hero headline/subline; section 2 two paragraphs
  (`LOCKIN_WHAT_IS` as a string array, reused by the email); section 3 two paragraphs; section 4
  four points (`{ title, text }`, e.g. "Your own quiet room", "No addictions" / "phone, scrolling,
  noise set aside", "One focus" / "the area of your life you choose", "Time and space to decide,
  plan and start"); gallery list (`{ src, alt }` for 5 photos, alt text with "issebya.homes"
  lowercase); section headings; full-form intro + reason; field labels; submit label
  "Join the waitlist"; thank-you headline "You're in.", text, follow-up question
  "What made you sign up?" and its submit label + saved line; generic error copy.
- `LOCKIN_OPT_IN_COPY = "I agree to receive emails about lock-in. Unsubscribe anytime."` with a
  comment that the action stores this server constant as `opt_in_copy`, never a form value.
- Option lists as `readonly { value, label }[]` `as const`: life areas (Work / business,
  Relationships, Health, Creative project, Other), durations (Weekend, 3 days, 7 days), months
  (November, December, January, Later), values matching the migration CHECKs exactly.
- `LOCKIN_HOST_TEXT = "[PLACEHOLDER: host text, 1 to 2 first-person sentences. Replace in copy.ts]"`
  and `LOCKIN_HOST_PHOTO = { src: "/living_room_puff.webp", alt: "..." }`, commented as the one
  place the owner swaps them.
- Metadata strings: title `"Lock-in waitlist | issebya.homes"` (no en/em dash), description = the
  subline, OG alt.
- Email: `LOCKIN_EMAIL_SUBJECT = "You're on the lock-in waitlist – issebya.homes"` (en dash,
  matching existing subjects; comment "never an em dash"), and
  `lockinWelcomeEmailText({ unsubscribeUrl })`: confirmation line, blank, the two `LOCKIN_WHAT_IS`
  paragraphs, blank, "You'll be the first to know when lock-in dates open.", blank, unsubscribe
  line + URL.
- Unsubscribe page copy: done / already / invalid.
- Every string obeys: "lock-in" lowercase (Lock-in sentence-initial), "issebya.homes", no `—`.

### 4. Schema module `src/lib/lockin-waitlist/schema.ts`

- `lockinWaitlistSchema` (z.object):
  - `email: emailSchema`
  - `name`: string, trim, max 100, `""` → `undefined` (optional)
  - `lifeArea`, `duration`: `z.enum(values from copy)` optional, `""` → `undefined`
  - `months`: `z.array(z.enum(month values))`, deduplicated, `[]` allowed (means "not answered")
  - `marketingOptIn: z.literal(true, { error: <friendly consent message from copy> })`
  - `honeypot: z.string().max(0)`
- `lockinWaitlistInputFromFormData(formData)`: `email`, `name`, `lifeArea`, `duration`,
  `months: formData.getAll("months").map(String)`, `marketingOptIn: get("marketingOptIn") === "on"`,
  `honeypot: get("website")`.
- `signupReasonSchema`: `followupToken` = 64 lowercase hex, `signupReason` trimmed 1..1000.
  `signupReasonInputFromFormData`.
- `LockinWaitlistFormState` `{ attempt, ok, errors: Partial<Record<"email"|"name"|"lifeArea"|"duration"|"months"|"marketingOptIn", string>>, generalError, email, followupToken }`
  and `initialLockinWaitlistState`; `SignupReasonFormState` `{ attempt, ok, errors: { signupReason? }, generalError }`
  and its initial state. Comment: `followupToken` is returned only to the browser that made this
  submit and is the only key to the follow-up write; `email` echoes only the visitor's own input.
- `lockinWaitlistUpsert(input, existing, now, newToken)` → `{ row, isNew, reconsented }`, pure:
  - `existing` is `{ name, life_area, duration, months, unsubscribed_at } | null`.
  - Each answer column = the new value if provided, else the existing value, else `null`
    (`months`: a non-empty new array wins, else existing). A short-form resubmit never wipes.
  - Always `marketing_opt_in: true`, `opted_in_at: now`, `opt_in_copy: LOCKIN_OPT_IN_COPY`,
    `followup_token: newToken()`.
  - `existing?.unsubscribed_at` → add `unsubscribed_at: null`, `unsubscribe_token: newToken()`,
    `reconsented: true`. A subscribed row keeps its unsubscribe token (not in the payload); a new
    row takes the column default. `isNew = existing === null`.
  - `signup_reason` is never in the payload, so a resubmit keeps an earlier answer.

### 5. Token + unsubscribe module `src/lib/lockin-waitlist/unsubscribe.ts`

- Copy the shape of `src/lib/shop/unsubscribe.ts` with `LOCKIN_UNSUBSCRIBE_PATH = "/lockin-waitlist/unsubscribe"`
  and table `lockin_waitlist`: `newLockinToken()` (32 random bytes hex, used for both tokens),
  `isLockinToken`, `lockinUnsubscribeUrl(token)`, `resolveLockinUnsubscribe(supabase, token)`
  (lookup by `unsubscribe_token`, `already` if unsubscribed, update filtered on
  `unsubscribed_at is null`, never delete, errors carry Postgres code only),
  `lockinUnsubscribeResultPath(outcome)`, `scrubLockinUnsubscribeToken(event)`.

### 6. OG image

- Center-crop `public/terrace.webp` to 1200×630 JPEG (quality ~80) at
  `public/og/lockin-waitlist.jpg`, < 300 KB. Use a one-off command (macOS `sips`, or `sharp`
  already in `node_modules` via a script in the scratchpad). Do not commit any script (no
  dependency added, same as the booking OG images).

### 7. Unit tests for Phase 1 (write now, make them pass)

- `copy.unit.test.ts`: no exported string (and the generated email text) contains `—`;
  none contains "Issebya Homes" or a capitalised "Issebya"; `lockinWelcomeEmailText` contains both
  `LOCKIN_WHAT_IS` paragraphs and the unsubscribe URL; option values equal the migration's lists.
- `schema.unit.test.ts`:
  - valid full submit passes (email normalised, months deduped);
  - **negative**: missing consent rejected; bad email rejected; `lifeArea: "Money"` rejected;
    `months: ["March"]` rejected; filled honeypot rejected; name > 100 rejected;
  - `signupReasonSchema`: malformed/missing token rejected, 1001 chars rejected;
  - merge: existing `life_area: "health"` + email-only input → `row.life_area === "health"` (also
    name, duration, months kept); new values override; unsubscribed existing + consent →
    `unsubscribed_at: null`, new `unsubscribe_token`, `reconsented: true`; subscribed existing →
    no `unsubscribe_token` in payload, `reconsented: false`; `followup_token` always fresh;
    no `signup_reason` key ever.
- `unsubscribe.unit.test.ts`: valid token → `unsubscribed`, update called with
  `marketing_opt_in: false` + `unsubscribed_at`, no `delete` ever called; already-unsubscribed row
  → `already`; concurrent second click (update matches no row) → `already`; unknown token →
  `invalid`; malformed/array token → `invalid` with no DB call; scrubber redacts `token=` on
  `/lockin-waitlist/unsubscribe` events and leaves other events untouched.

### 8. Welcome email sender in `src/lib/resend.ts`

- Add `sendLockinWaitlistWelcomeEmail({ email, unsubscribeToken })`, mirroring
  `sendWishlistConfirmationEmail`: `RESEND_FROM_EMAIL` required, `replyTo` admin if set,
  `subject: LOCKIN_EMAIL_SUBJECT`, `text: lockinWelcomeEmailText(...)`,
  `headers: { "List-Unsubscribe": <url> }`, throw on Resend `{ error }`. Do not touch the existing
  functions.

### 9. Server Actions `src/app/lockin-waitlist/actions.ts`

- `"use server"`, exports only the two async functions.
- `joinLockinWaitlist(prevState, formData)`:
  1. `attempt = prev + 1`, map FormData, `safeParse`.
  2. Honeypot issue present → breadcrumb, return `ok: true`, `followupToken: ""`, no DB, no email.
  3. Other issues → inline `errors` per field (first message wins), `ok: false`.
  4. `startSpan({ name: "lockin.waitlist.join", ... })` with no email in attributes.
  5. Pre-read `select("name, life_area, duration, months, unsubscribed_at").eq("email").maybeSingle()`;
     on error `captureException` + general error.
  6. `lockinWaitlistUpsert(...)`; `upsert(row, { onConflict: "email" }).select("unsubscribe_token, followup_token").single()`;
     on error capture + general error.
  7. If `isNew || reconsented`: `try { await sendLockinWaitlistWelcomeEmail(...) } catch { console.error; captureException(error, { tags: { "email.type": "lockin_waitlist_welcome" } }) }`.
  8. Return `ok: true`, `email`, `followupToken: stored followup_token`.
- `saveSignupReason(prevState, formData)`:
  1. Parse with `signupReasonSchema`. Token invalid/missing → return `ok: true` silently with no DB
     call (never reveal anything; a honeypot visitor's empty token lands here). Reason invalid →
     inline error.
  2. `update({ signup_reason, followup_token: null }).eq("followup_token", token).select("email")`.
     Zero rows → still `ok: true`, nothing written. DB error → capture + general error.
  3. Never reads or accepts an email.

### 10. Action unit test `src/app/lockin-waitlist/__tests__/actions.unit.test.ts`

- Mock `@/lib/shared/supabase`, `@/lib/resend`, `@sentry/nextjs` as the wishlist action test does.
- new email → one upsert (payload has `opt_in_copy === LOCKIN_OPT_IN_COPY` even if the form posts
  another `opt_in_copy`), one email sent with the stored unsubscribe token, `ok`, non-empty
  `followupToken`;
- same subscribed email again → upsert, **no** email, `ok`;
- unsubscribed email again → email sent (re-consent);
- honeypot filled → no `from()` call, no email, `ok`;
- Resend throws → upsert done, `ok: true`, `captureException` called with the email tag;
- bad email / missing consent → inline errors, no DB call;
- `saveSignupReason`: valid token → update filtered on that token with `followup_token: null`;
  **negative**: wrong token (update returns `[]`) writes nothing else; missing or malformed token →
  no `from()` call at all; a FormData carrying `email` is ignored (update filter is the token only).

### 11. Unsubscribe route + pages (outside `(main)`)

- `unsubscribe/route.ts`: copy of the wishlist route using `resolveLockinUnsubscribe` /
  `lockinUnsubscribeResultPath`, 303 redirect, repeated `token` param treated as invalid.
- `done/page.tsx`, `already/page.tsx`: `metadata` `{ title: "Unsubscribed | issebya.homes", robots: { index: false, follow: false } }`,
  render `UnsubscribeMessage` with the copy constant. `invalid/page.tsx` calls `notFound()`;
  `invalid/not-found.tsx` renders the invalid copy.
- `_components/UnsubscribeMessage.tsx`: calm centred card, no links (no chrome, nothing to link to
  while unreleased).
- Extend `unsubscribe.unit.test.ts` only if route logic beyond the resolver is added (it should not be).

### 12. Sentry scrubber chain

- In `sentry.server.config.ts`, change both hooks to
  `(event) => scrubLockinUnsubscribeToken(scrubUnsubscribeToken(event))` and update the comment.

### 13. Layout and page

- `layout.tsx`: returns `<main className="...">{children}</main>`. No Header/Footer import.
- `page.tsx`: Server Component, static (no request data, so it prerenders under `cacheComponents`).
  - `export const metadata: Metadata` with `title`, `description`,
    `robots: { index: false, follow: false }`,
    `openGraph: { title, description, url: "/lockin-waitlist", type: "website", images: [{ url: "/og/lockin-waitlist.jpg", width: 1200, height: 630, type: "image/jpeg", alt }] }`,
    `twitter: { card: "summary_large_image", title, description, images: ["/og/lockin-waitlist.jpg"] }`.
  - Sections in order, mobile-first single column widening on `md:`; semantic `<section>` with
    `aria-labelledby` headings; one `<h1>` (hero headline):
    1. Hero: headline, subline, `<WaitlistShortForm />`. Text-only, no hero image, for a fast LCP.
    2. What a lock-in is. 3. Why not at home.
    3. What happens: four points, each with a small inline SVG icon (`aria-hidden`).
    4. The space: 5 photos from the copy module, `next/image` with `sizes`, default lazy loading.
    5. Who's behind it: `LOCKIN_HOST_PHOTO` via `next/image` + `LOCKIN_HOST_TEXT`.
    6. Full form: intro, reason, `<WaitlistFullForm />`.
  - No `<header>` element, no `<nav>`, no `Link` except the `/privacy-policy` link inside the
    consent label. Use `<div>`/`<section>` for the hero, not `<header>`.
  - Use the existing palette and fonts (`branding-guidelines.md`); visible `focus-visible` outlines
    on every input/button; text contrast at least WCAG AA.

### 14. Client forms

- `ConsentField`: `<input type="checkbox" name="marketingOptIn" id=...>` + `<label>` with
  `LOCKIN_OPT_IN_COPY` and a `/privacy-policy` link (`<a>` or `next/link`, opens in same tab),
  inline error `role="alert"` linked via `aria-describedby`; reports its checked state to the parent.
- `WaitlistShortForm` (`"use client"`): `useActionState(joinLockinWaitlist, initialLockinWaitlistState)`;
  form `noValidate` so server Zod errors render inline; labelled email input (re-keyed by
  `state.attempt` and seeded with `state.email`), hidden honeypot `website` input (visually hidden,
  `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`), `ConsentField`, submit "Join the waitlist"
  **disabled until consent is ticked** and while pending; `generalError` in `role="alert"`.
  `state.ok` → render `<WaitlistThankYou followupToken={state.followupToken} />` in place of the form.
- `WaitlistFullForm` (`"use client"`): same plus `name` text input, life area radio group,
  duration radio group, months checkbox group (`name="months"`), each in `<fieldset>` + `<legend>`,
  each option with its own `<label>`. Use distinct `useId` ids so both forms coexist on one page.
  Re-seed answers from echoed state on error is optional: if inputs reset on an error submit,
  echo `name/lifeArea/duration/months` in state the same way as `email`.
- `WaitlistThankYou`: `role="status"` container, "You're in." heading, text, follow-up form using
  `useActionState(saveSignupReason, ...)`: hidden `followupToken` input, labelled `<textarea
name="signupReason" maxLength={1000}>`, submit; on `ok` replace the follow-up with a short
  thanks line from copy. Focus moves to the heading when it mounts (via ref in a callback ref, not
  an effect) so screen readers announce the swap.

### 15. Browser test `_components/WaitlistForms.browser.test.tsx`

- Mock `../actions` (both functions) and `@sentry/nextjs`, as `WishlistDialog.browser.test.tsx` does.
- Short form: submit button disabled before consent, enabled after ticking; action not called
  while disabled.
- Full form: action mocked to return `errors.email` for "not-an-email" → inline error visible,
  form still present (no navigation), action called once.
- Successful submit → "You're in." visible, the submitted form's email input gone, the _other_
  form still present.
- Thank-you follow-up submit sends the `followupToken` from state in its FormData.

### 16. Playwright metadata spec `e2e/lockin-waitlist.integration.spec.ts`

- Modelled on `booking-og-metadata.integration.spec.ts`. `request.get("/lockin-waitlist")` with
  the WhatsApp UA; assert 200; `<head>` contains `<meta name="robots" content="noindex, nofollow">`;
  `og:image` ends with `/og/lockin-waitlist.jpg`, width 1200, height 630, type `image/jpeg`;
  fetching `/og/lockin-waitlist.jpg` returns 200 `image/jpeg` < 300 KB; the HTML has no `<header`;
  every `href="..."` inside `<body>` that is an anchor equals `/privacy-policy` (ignore
  `<link>` asset tags in `<head>`). No DB needed, so it runs safely in the ADW test phase.

### 17. Review screenshots (review phase, no code)

- Paths on `http://localhost:$PORT`: `/lockin-waitlist` at mobile 390px wide (and the profile's
  375x667) and desktop 1920x1080, full page; the thank-you state after a short-form submit;
  `/lockin-waitlist/unsubscribe/done`. Must show: no header/footer/nav, the hero headline and
  short form above the fold on mobile, all seven sections, gallery photos, the visible host
  placeholder, the thank-you panel replacing only the submitted form.
- If the migration is not applied on the shared instance (expected in an ADW run), a real submit
  returns the general error. To capture the thank-you state, set the hidden `website` honeypot
  input via `browser_evaluate` before submitting: that path returns the thank-you state with no DB
  write. Say so in the review notes.

### 18. Run the Validation Commands

- Run every command below; all must pass with zero regressions.

## Testing Strategy

### Unit Tests

- `copy.unit.test.ts` - copy rules (no em dash, brand spelling), email text contents, option values.
- `schema.unit.test.ts` - Zod accept/reject incl. all negatives in the issue; merge semantics.
- `unsubscribe.unit.test.ts` - resolver states, never deletes, token format, Sentry scrub.
- `actions.unit.test.ts` - both Server Actions with Supabase/Resend/Sentry mocked.
- `WaitlistForms.browser.test.tsx` - consent gating, inline error without navigation, in-place
  thank-you, token passed to follow-up.

### Test Coverage

- `schema.unit.test.ts` (unit): catches bad email / off-list choices / missing consent / honeypot
  getting through, and a short-form resubmit wiping full-form answers. No such module exists today.
- `unsubscribe.unit.test.ts` (unit): catches the lock-in link deleting rows, failing to reach
  `already`, or leaking its token to Sentry.
- `actions.unit.test.ts` (unit): catches duplicate welcome emails, an email failure failing the
  sign-up, honeypot writes, and the follow-up writing with a wrong/missing token or by email.
- `copy.unit.test.ts` (unit): catches an em dash or "Issebya Homes" slipping into copy or email.
- `WaitlistForms.browser.test.tsx` (browser, gated): catches submit without consent, a reload or
  lost inline error, and the thank-you not replacing the form.
- `e2e/lockin-waitlist.integration.spec.ts` (Playwright, ADW test phase): catches the page being
  indexable, losing its JPEG OG card, picking up the site header, or gaining a stray link.
- Migration `anon` permission check: manual by the owner (see Notes); an ADW run may not apply
  migrations on the shared instance.

### Edge Cases

- Email with spaces/uppercase → stored normalised; same person in different case is one row.
- Short-form submit after a full-form submit keeps name, life area, duration, months, signup reason.
- Full-form resubmit with new answers overwrites only the answered fields.
- Already-subscribed resubmit: no email; unsubscribed resubmit: email + new unsubscribe token, old
  link answers `already`/`invalid`, not unsubscribing the renewed consent.
- Visitor submits the hero form and then the full form: each thank-you has its own follow-up token;
  only the latest token is valid (rotated per submit), the older follow-up writes nothing.
- Follow-up token used twice → second write matches no row (token cleared).
- `months` repeated values deduped; `months` empty means "not answered", stored as `null`.
- Repeated or missing `token` on unsubscribe → invalid (404 page).
- Resend error object or thrown error → captured, sign-up still ok.
- JavaScript disabled: forms still post via Server Action (progressive enhancement); the
  consent-disabled button means no-JS users must tick first, which works natively.

## Acceptance Criteria

- `/lockin-waitlist` renders all seven sections with the issue's copy verbatim, sourced from
  `src/lib/lockin-waitlist/copy.ts`, mobile first, no `Header`/`Footer`/`<header>`/nav.
- The only anchor on the page targets `/privacy-policy`.
- Metadata: `noindex, nofollow`; own title/description; OG + Twitter image `/og/lockin-waitlist.jpg`,
  1200×630 JPEG with declared width/height/type. Not in `sitemap.ts`, not linked anywhere.
- Both forms validate with Zod in the Server Action, show inline errors without reload, require
  consent, use the `website` honeypot, and swap in the thank-you panel in place on success.
- `lockin_waitlist` migration matches the Storage section (normalised email PK, checked enums,
  two-state consent check, tokens, trigger, RLS with zero policies, revoke from anon/authenticated).
- Duplicates merge without wiping; re-consent rotates the unsubscribe token.
- Welcome email only on new sign-up or re-consent, with the unsubscribe link and `List-Unsubscribe`
  header; a send failure is captured in Sentry and never fails the sign-up.
- Follow-up answer writes only via the server-issued `followup_token`; never by email.
- `/lockin-waitlist/unsubscribe?token=...` → done / already / invalid; never deletes.
- No em dashes in page, metadata or email; brand always `issebya.homes`.
- `/lock-in/*`, `/booking/*`, Header, Footer, `sitemap.ts`, `src/lib/shop/**` and all
  `shop_wishlist_*` code and migrations unchanged (`git diff --stat develop` shows none of them).
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website` - types across new modules, actions and pages.
- `yarn turbo run lint --filter=./apps/website` - lint rules (incl. security/no-secrets plugins).
- `yarn prettier --check .` - formatting, as lefthook enforces.
- `yarn knip` - no unused exports/files from the new modules.
- `yarn turbo run test --filter=./apps/website` - unit + chromium browser projects, incl. all new tests.
- `yarn turbo run typecheck lint test --filter=./apps/website` - the issue's required gate, verbatim.
- `yarn turbo run build --filter=./apps/website` - proves the page prerenders under
  `cacheComponents`, the route table lists `/lockin-waitlist` as static, and `.env.production` loads.
- `git diff --stat origin/develop -- apps/website/src/app/sitemap.ts apps/website/src/app/ui apps/website/src/lib/shop "apps/website/src/app/(main)" supabase/migrations/20260924120000_create_shop_wishlist.sql supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql` - must print nothing (constraints untouched).

## Notes

- **Migration apply and `anon` check are an owner step, not an ADW step.** The issue asks for
  `supabase migration up` locally and an `anon` select check, but the ADW profile's Protected
  section forbids running any migration on the shared local Supabase in a run. After merge, the
  owner runs from the main checkout: `yarn supabase migration up`, then
  `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "set role anon; select * from public.lockin_waitlist;"`
  and expects `permission denied for table lockin_waitlist`. Production gets it through the
  existing migrations workflow on promotion to `master` (see `production-migrations.md`; note the
  memory'd gap that the eval-gate paths filter can block SQL-only promotions, not an issue here as
  website code changes too).
- **Stored values are slugs, not labels** (`health`, `work_business`, `3_days`, `november`...), so a
  copy tweak never needs a migration. They stay readable in a Studio CSV export. The issue's test
  examples (`"Money"`, `"March"`, `"Health"`) map to `"Money"`/`"March"` rejected and
  `"health"` kept.
- **Follow-up token threat model.** The token is returned only in the submitting browser's action
  state, rotated every submit and cleared on use, so nobody can write a reason to a record they did
  not just submit. Anyone can still submit someone else's email (inherent to any email-only form);
  that sets fields but cannot wipe them and never exposes data back.
- Two concurrent first submits for one email could both see "no row" and send two welcome emails.
  Accepted, same as the wishlist's tolerance; not worth a lock.
- No new dependency. No analytics, PostHog, UTM or flags (out of scope).
- The host text/photo is a visible placeholder by design; the owner edits
  `LOCKIN_HOST_TEXT` / `LOCKIN_HOST_PHOTO` in `copy.ts` only.
- The document phase writes `apps/website/app_docs/feature-7deb859c-lockin-waitlist-landing-page.md`
  and appends its entry to the `## apps/website` section of `docs/conditional-docs.md`.
- Commit scope: `website` for app code; the migration rides in the same feature commit
  (multi-area change) or a separate unscoped commit, per the profile's commit convention.
