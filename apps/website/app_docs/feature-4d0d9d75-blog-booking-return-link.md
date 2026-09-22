# Booking from a blog post returns the reader to the post

**ADW ID:** 4d0d9d75
**Date:** 2026-09-21
**Specification:** `specs/issue-94-adw-4d0d9d75-sdlc_planner-blog-booking-return-link.md`

## Overview

A reader can book directly inside a blog post through `<BookingWidget />`, which
renders the real booking engine rather than a link out. Until now that booking
ran the same checkout as `/booking/[type]`: after payment the guest landed on
`/booking/confirmation` with no route back, and cancelling checkout dropped them
on `/booking/<room>`, a page they had never visited. The originating post now
travels through the Stripe round trip, so the confirmation page offers a link
back to the post and the cancel URL lands on the post at the widget. Bookings
that start on `/booking/[type]` are byte-identical to before.

## What Was Built

- `resolveBlogReturn`, the single definition of a valid return target: a
  `/blog/<slug>` path whose slug names a post the registry actually has.
- `blogReturnPathSchema` plus a `returnTo` field on `checkoutSchema`, so the
  return target is validated at the Zod boundary like every other input.
- A `returnTo` argument on the `submitBooking` Server Function, threaded into
  Stripe's `success_url` (as a `return=` query parameter) and `cancel_url`.
- A `#book` anchor on the booking widget's `<aside>`, so a return lands at the
  widget rather than the top of the article.
- A back link on `/booking/confirmation`, rendered only when the `return` query
  parameter revalidates against the post registry.
- Unit, browser and Playwright coverage, including four forged-target cases.

## Technical Implementation

### Files Modified

- `apps/website/src/lib/blog/return-path.ts` (new): `resolveBlogReturn` and the
  exported `BOOKING_WIDGET_ANCHOR_ID`. Returns `{ path, href, title }` or
  `null`. A file-level JSDoc records why both the shape check and the registry
  check live here, and why calling it at two boundaries is not duplication.
- `apps/website/src/lib/shared/schemas/booking.ts`: adds `blogReturnPathSchema`
  and `returnTo: blogReturnPathSchema.nullable().catch(null)` on
  `checkoutSchema`.
- `apps/website/src/app/(main)/booking/[type]/actions.ts`: `submitBooking` takes
  a fifth positional argument, `returnTo`, resolves it once, and builds
  `success_url` / `cancel_url` from the result.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx`:
  reads `usePathname()`, shape-checks it with the same schema, and passes it to
  the action.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`: the `<aside>` now
  carries `id={BOOKING_WIDGET_ANCHOR_ID}`.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx`: widens
  `searchParams` with `return`, revalidates it through `resolveBlogReturn`, and
  renders a `data-testid="return-to-post"` link when it resolves.
- `apps/website/src/lib/blog/__tests__/return-path.unit.test.ts` (new): the
  resolver suite, covering the happy path, malformed shapes, absolute and
  protocol-relative URLs, and a well-shaped slug that names no post.
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts`:
  three tests pinning the Stripe URLs, the unchanged no-return case, and
  `source` surviving alongside a resolved return path.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx`:
  mocks `usePathname` and asserts the fifth argument in both render contexts.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: a new describe block
  seeding a confirmed booking, following the link to the post's widget, and
  four forged-target cases.

### Key Changes

- **One rule, enforced at two trust boundaries.** `submitBooking` validates an
  argument the browser sent; the confirmation page validates a query parameter
  that came back through Stripe and that anyone can type by hand. Both route
  through `resolveBlogReturn`, so the two boundaries cannot drift on what counts
  as valid, and neither can become an open redirect.
- **Shape is not enough, and existence is not enough.** `/blog/does-not-exist`
  passes the regex; `https://evil.example/` fails nothing else. The resolver
  runs both checks, which is why it, not either call site, owns the rule.
- **A hostile return target costs the link, never the booking.** `returnTo` is
  the only field in `checkoutSchema` using `.catch(null)`. Everything else still
  fails loudly; a malformed return target degrades to "no return target" and
  checkout proceeds on today's URLs.
- **The no-return path is character-for-character unchanged.** With no resolved
  target, `returnParam` is the empty string and `cancel_url` collapses to
  `${origin}/booking/${roomType}`, exactly as before. The `no-secrets`
  eslint-disable above `success_url` is a `disable-next-line` and stays
  load-bearing: reflowing that template literal silently un-suppresses the rule.
- **The client only knows where it is, not what is valid.** `usePathname()` in
  the already-client `BookingEngineExpanded` is the only thing that tells a
  widget render from a `/booking/[type]` render. It shape-checks with the shared
  schema and never imports the post registry; the server has the final word.
  `/blog/[slug]` stays prerendered.
- **The regex is split deliberately.** A flat `[a-z0-9-]+` class plus a refine
  rejecting leading, trailing and doubled hyphens, rather than a nested
  quantifier that `security/detect-unsafe-regex` flags as a ReDoS shape. Same
  accepted strings, linear time, matching the post `slug` rule in
  `src/lib/blog/schema.ts`.

## How to Use

1. Open a post that renders the widget, e.g. `/blog/welcome-to-issebya-homes`.
2. Book from inside the post: pick a room, pick dates, fill the contact fields
   and confirm.
3. On the hosted Stripe page, either pay or cancel.
   - Paying lands on `/booking/confirmation?session=…&return=/blog/<slug>`,
     which renders `← back to <post title>` pointing at `/blog/<slug>#book`.
   - Cancelling lands directly on `/blog/<slug>#book`.
4. Either way the reader arrives at the widget, not the top of the article.

Bookings started on `/booking/room1` or `/booking/room2` behave exactly as
before: no `return` parameter, no back link, the original cancel URL.

## Configuration

None. No environment variable, no migration, no new column, no new Stripe
metadata key, and no new dependency (Zod, `next/link` and `next/navigation` are
already in the workspace). The originating post is deliberately not persisted;
it exists only in the Stripe URLs for the duration of the checkout round trip.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the unit project: the
  resolver suite and the extended `submitBooking` suite.
- `yarn workspace website test:browser --run` runs the browser project, which
  `turbo run test` does not. This is where the `usePathname` assertions live.
- `yarn workspace website test:integration` runs Playwright, including the
  confirmation-page tests. They seed a **confirmed** booking directly in the
  shared local Supabase and clean it up in a `finally`, using room2 on days
  +40..+43 to stay clear of the room1 +10..+13 window other booking specs use.
- `yarn turbo run build --filter=./apps/website` is the only real proof that
  `/blog/[slug]` is still prerendered; check the route table.
- Also run `yarn turbo run lint --filter=./apps/website` to confirm the
  `no-secrets` disable still covers `success_url`.

## Notes

- **One widget per post.** The `#book` anchor is a DOM id, so a second widget in
  the same post would be a duplicate id and the browser would land on the first.
- **Not provable by the pipeline:** that Stripe preserves the extra query
  parameter on `success_url` and that the hosted page's cancel button lands on
  the post. The E2E Stripe mock ignores the request body entirely, so one
  test-mode booking from the widget against real Stripe Checkout is worth doing
  by hand before this ships.
- **Slug charset coupling.** `blogReturnPathSchema` and the post `slug` rule in
  `src/lib/blog/schema.ts` accept the same strings. A future post with a
  different charset would parse as a post but silently lose its return link;
  change both rules together.
- **Follow-up, not built here:** the same mechanism would let a GCA WhatsApp
  booking link return the guest to a chosen page. The resolver is shaped so a
  second allowed prefix could be added without touching either call site.
