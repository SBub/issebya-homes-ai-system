# Feature: Booking from a blog post returns the reader to the post

## Metadata

issue_number: `94`
adw_id: `4d0d9d75`
issue_json: `{"number":94,"title":"Booking from a blog post: confirmation (and cancel) should return the reader to the post","body":"A reader can book from inside a blog post (<BookingWidget /> in apps/website/src/app/(main)/blog/ui/BookingWidget.tsx, dropped into a post via src/mdx-components.tsx). The widget is the real engine, so booking from a post runs the same path as booking from /booking/[type]: BookingEngineExpanded calls submitBooking(roomType, checkIn, checkOut, source, prevState, formData); submitBooking creates a Stripe Checkout session with success_url ${origin}/booking/confirmation?session={CHECKOUT_SESSION_ID} and cancel_url ${origin}/booking/${roomType}. After payment the guest lands on /booking/confirmation with no link anywhere; on cancel they land on /booking/<room>, a page they never came from. Opportunity: when a booking starts from a blog post, the confirmation page offers a way back to that post, landing the reader at the widget, and cancelling checkout returns them to the same place. Bookings that start on /booking/[type] are unchanged. Constraints: the return target is untrusted input at both boundaries (Server Function argument, and a forgeable query param on /booking/confirmation) and must never become an open redirect - accepted only as /blog/<slug> where getPostBySlug(slug) returns a post, everything else dropped with a fallback to today's values; validate it in checkoutSchema (Zod at all API boundaries); success_url must keep session={CHECKOUT_SESSION_ID} and the existing eslint-disable no-secrets comment; bookings from /booking/[type] produce byte-identical Stripe parameters to today and source keeps its meaning; /blog/[slug] must stay prerendered (no headers()/cookies()/searchParams in that route - usePathname() in the already-client BookingEngineExpanded is fine); /booking/confirmation stays dynamic and keeps its session handling, rendering the return link from the validated query param with no second fetch; calendar days stay yyyy-MM-dd strings; the confirmation email and the Stripe webhook are unchanged. Suggestion: give the widget aside an id (book) so the post URL lands the reader at the widget; thread returnTo: string | null through submitBooking next to source, taken from usePathname(); success_url gains &return=<encoded path> and cancel_url becomes ${origin}<path>#book; confirmation/page.tsx reads return from searchParams, re-validates it, and renders a link titled with the post's real title, with data-testid=return-to-post. Verification: extend actions.unit.test.ts (positive, null, and the negative cases https://evil.example/, //evil.example, /blog/does-not-exist, /booking/room1); prove the confirmation page end to end in Playwright by seeding a confirmed bookings row via createAdminClient() the way the dates-unavailable test does, cleaning up in finally; existing blog booking and /booking/room1 flows untouched; yarn build still lists /blog/[slug] as prerendered; lint/typecheck/test/knip green plus yarn test:integration. Out of scope: breadcrumbs on the post page, scroll restoration beyond the anchor, restoring the widget's expanded state, mentioning the post in the confirmation email, recording the originating post in the bookings table or Stripe metadata, and any change to /booking/[type]'s own confirmation or cancel experience."}`

## Feature Description

A reader can already book a stay from inside a blog post: `<BookingWidget />`
renders the real booking engine mid-article, and submitting it runs the same
`submitBooking` Server Action and the same Stripe Checkout as `/booking/[type]`.
What the flow does not do is remember where it started. After payment the guest
lands on `/booking/confirmation`, a page with no link anywhere; if they abandon
checkout, Stripe returns them to `/booking/<room>`, a standalone page they have
never seen.

This feature threads the originating post through the checkout round trip. When
the widget is submitted from `/blog/<slug>`, the booking's Stripe session is
created with a `success_url` that carries an extra `return=/blog/<slug>`
parameter and a `cancel_url` that points at the post's booking widget
(`/blog/<slug>#book`). The confirmation page reads that parameter, revalidates
it, and renders a link back to the post, titled with the post's real title, that
lands the reader at the widget they booked from.

The return target is untrusted at both boundaries. It arrives first as a Server
Function argument from the browser, then as a query parameter on a dynamic page
that anyone can forge. At both points it is accepted only if it is a
root-relative path of the shape `/blog/<slug>` **and** `getPostBySlug(slug)`
returns a real post. Anything else (an absolute URL, a protocol-relative
`//evil`, an unknown slug, a non-blog path) is dropped: the booking still
succeeds, the Stripe URLs fall back to exactly today's values, and the
confirmation page renders exactly today's page with no link and no error.

Bookings that start on `/booking/[type]` are byte-identical to today. `source`
(`"direct"` / `"gca"`) keeps its meaning and its PostHog `booking_source` value
and is not overloaded.

## User Story

As a reader who was midway through a blog post and booked a stay from the widget
inside it
I want the confirmation page (and the cancel path out of Stripe) to offer me a
way back to the post I was reading
So that paying, or changing my mind, does not throw away the article I was in
the middle of and dump me on a page I never asked for

## Problem Statement

Nothing in the booking flow records where a booking started. `submitBooking`
builds both Stripe URLs from `origin` and `roomType` alone:

- `success_url: ${origin}/booking/confirmation?session={CHECKOUT_SESSION_ID}`
- `cancel_url: ${origin}/booking/${roomType}`

Consequently:

1. A reader who books mid-article is dropped on a dead-end confirmation page
   (`src/app/(main)/booking/confirmation/page.tsx` renders booking details and
   no link at all), with the browser back button as the only route back into
   the article, and back through a Stripe redirect chain is not a route most
   readers will take.
2. A reader who abandons checkout is returned to `/booking/<room>` - a page
   they never came from, with none of the article's context.

The engine is deliberately shared between the widget and `/booking/[type]`, so
the fix has to be additive: it cannot change what a `/booking/[type]` booking
sends to Stripe, and it cannot pull request data into `/blog/[slug]`, which is
prerendered and must stay that way.

## Solution Statement

Thread an optional, validated `returnTo` path through the existing checkout
path, and render it back on the confirmation page.

1. **A shape schema, in the schema module.** `blogReturnPathSchema` in
   `src/lib/shared/schemas/booking.ts` pins the shape `/blog/<slug>`.
   `checkoutSchema` gains `returnTo: blogReturnPathSchema.nullable().catch(null)`
   - `.catch(null)` is what makes a forged or malformed value degrade to "no
     return target" instead of failing the booking, while keeping the validation
     inside the schema, per `apps/website/AGENTS.md` (Zod at all API boundaries).
2. **An existence check, in one shared resolver.** A new
   `src/lib/blog/return-path.ts` exports `resolveBlogReturn(value)`, which
   applies the shape schema and then `getPostBySlug(slug)`, returning
   `{ path, href, title }` for a real post and `null` for everything else. Both
   trust boundaries call this one function, so the server action and the
   confirmation page cannot drift apart on what counts as valid.
3. **The origin, read where the client already lives.**
   `BookingEngineExpanded` is already a Client Component reading
   `useSearchParams()`; it adds `usePathname()` in the same breath and passes
   the pathname as `returnTo` only when it matches the blog-post shape, else
   `null`. Nothing about `/blog/[slug]`'s server render changes, so the route
   stays prerendered.
4. **The Stripe URLs become conditional.** With a resolved return path,
   `success_url` gains `&return=<encoded path>` after the untouched
   `session={CHECKOUT_SESSION_ID}` placeholder, and `cancel_url` becomes
   `${origin}<path>#book`. With `null`, both strings are assembled to exactly
   today's values.
5. **The anchor.** `BookingWidget`'s `<aside>` gets `id="book"`, so returning to
   `/blog/<slug>#book` lands the reader at the widget rather than at the top of
   the article.
6. **The confirmation link.** `confirmation/page.tsx` reads `return` alongside
   the `session` it already reads, runs it back through `resolveBlogReturn`, and
   renders a `data-testid="return-to-post"` link when it resolves. The page
   stays dynamic, keeps its `headers()`-derived origin and its
   `/api/bookings/direct` fetch, and does no second fetch: the post title comes
   from the in-process post registry.

## Relevant Files

Use these files to implement the feature:

- `apps/website/src/lib/shared/schemas/booking.ts` - holds `checkoutSchema`, the
  Server Action's validation boundary. Gains the exported
  `blogReturnPathSchema` and the `returnTo` field.
- `apps/website/src/app/(main)/booking/[type]/actions.ts` - `submitBooking`.
  Gains the `returnTo` parameter, passes it into `checkoutSchema`, resolves it
  through `resolveBlogReturn`, and builds the two conditional Stripe URLs. The
  `eslint-disable-next-line no-secrets/no-secrets` comment on the `success_url`
  line stays exactly where it is.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` -
  the only caller of `submitBooking`. Adds `usePathname()` and passes the
  pathname (or `null`) as the new argument.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` - the widget's
  `<aside>` gains the anchor id.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx` - reads and
  revalidates `return`, and renders the link.
- `apps/website/src/lib/blog/posts.ts` - `getPostBySlug` is the authority on
  which slugs exist. Read-only; not modified.
- `apps/website/src/lib/blog/schema.ts` - `BlogPost` type, for the resolver's
  return type.
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts` -
  already unit-tests `submitBooking` with `stripe.checkout.sessions.create`
  mocked; extended with the positive, null and negative `returnTo` cases.
- `apps/website/src/schemas/__tests__/booking.unit.test.ts` - existing
  `checkoutSchema` tests; its `validData` fixture omits `returnTo`, which must
  keep passing.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx`
  - mocks `next/navigation` with `useSearchParams` only. It must gain
    `usePathname`, or every test in it throws once the component calls it.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` - the widget's
  existing end-to-end coverage; gains the confirmation-page tests.
- `apps/website/e2e/booking-flow.integration.spec.ts` - the fixture-seeding and
  `finally`-cleanup pattern to copy (the dates-unavailable test). Not modified.
- `apps/website/playwright.config.ts` - records why the suite runs with
  `workers: 1` and why fixture dates across spec files collide. Read before
  choosing the new fixture's room and dates.
- `apps/website/src/instrumentation.ts` - the in-process MSW mock gated on
  `E2E_MOCK_STRIPE`. Only touched if the confirmation fixture turns out to need
  a `GET /v1/checkout/sessions/:id` handler (it should not - see Phase 3).
- `apps/website/src/app/api/bookings/direct/route.ts` - read-only. Confirms
  that a booking row already at `status: "confirmed"` is returned without any
  Stripe call, which is what keeps the new E2E test from needing a new mock.
- `apps/website/AGENTS.md` - calendar-day rules, Zod at all API boundaries, no
  Radix, server components by default.
- `apps/website/app_docs/zod-validation-guide.md` - schema conventions.
- `apps/website/app_docs/dynamic-url-construction.md` - read before building any
  URL; both Stripe URLs are built from the `headers()`-derived origin and must
  stay that way.
- `apps/website/app_docs/nextjs-patterns-guide.md` - server/client boundaries and
  Server Action conventions.
- `apps/website/app_docs/client-form-guide.md` - `useActionState` conventions,
  for the changed action signature.
- `apps/website/app_docs/testing/unit_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md` - test conventions.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` - why the
  widget is shaped the way it is and what must not regress.
- `apps/website/app_docs/feature-437bcd03-blog-breadcrumb-trail.md` - records the
  prerendering gotcha around reading the URL in a blog route, and the `next/link`
  import failure in browser mode.

### New Files

- `apps/website/src/lib/blog/return-path.ts` - the shared resolver
  (`resolveBlogReturn`) and the widget anchor constant
  (`BOOKING_WIDGET_ANCHOR_ID`). One module, imported by the Server Action, the
  confirmation page and the widget, so the "what is a valid return target"
  rule exists exactly once.
- `apps/website/src/lib/blog/__tests__/return-path.unit.test.ts` - node-pool
  unit tests for the resolver, including every rejection case.

## Implementation Plan

### Phase 1: Foundation

Establish the validation rule and the anchor before anything consumes them.

- Add `blogReturnPathSchema` to `src/lib/shared/schemas/booking.ts` and wire a
  `returnTo` field into `checkoutSchema` that degrades to `null` rather than
  failing a booking.
- Add `src/lib/blog/return-path.ts` with `BOOKING_WIDGET_ANCHOR_ID` and
  `resolveBlogReturn`, the single place that combines shape validation with the
  `getPostBySlug` existence check.
- Unit-test the resolver directly, with `@/lib/blog/posts` mocked so the node
  pool never has to resolve an `.mdx` import.
- Give `BookingWidget`'s `<aside>` the anchor id from the constant.

### Phase 2: Core Implementation

Thread the value through the checkout round trip.

- `submitBooking` takes `returnTo: string | null` immediately after `source`,
  feeds it to `checkoutSchema`, and resolves the validated value through
  `resolveBlogReturn`. Both Stripe URLs are assembled from the result, with the
  `null` branch producing today's strings character for character.
- `BookingEngineExpanded` reads `usePathname()` and passes it (or `null`) into
  the action.
- Extend `actions.unit.test.ts` with the positive, null and four negative cases.
- Update the `next/navigation` mock in
  `BookingEngineExpanded.browser.test.tsx` so the existing suite keeps passing.

### Phase 3: Integration

Render the return link and prove the round trip.

- `confirmation/page.tsx` reads `return` from `searchParams`, revalidates it
  with the same resolver, and renders the link when it resolves.
- Extend `e2e/blog-booking-flow.integration.spec.ts` with a seeded confirmed
  booking and two navigations: one with a valid `return`, one with a forged one.
  The seeded row is `status: "confirmed"`, so `/api/bookings/direct` returns it
  straight from the database without touching Stripe - no new MSW handler is
  needed. If that turns out to be wrong in practice, add an `E2E_MOCK_STRIPE`
  handler for `GET https://api.stripe.com/v1/checkout/sessions/:id` returning
  `payment_status: "paid"` alongside the existing POST handler, rather than
  skipping the test.
- Confirm `/blog/[slug]` is still prerendered in the build route table.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions that apply

- Read `apps/website/AGENTS.md`.
- Read `apps/website/app_docs/zod-validation-guide.md`,
  `apps/website/app_docs/dynamic-url-construction.md`,
  `apps/website/app_docs/nextjs-patterns-guide.md`,
  `apps/website/app_docs/client-form-guide.md`,
  `apps/website/app_docs/testing/unit_test_spec_format.md` and
  `apps/website/app_docs/testing/e2e_example.md`.
- Read `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` and
  `apps/website/app_docs/feature-437bcd03-blog-breadcrumb-trail.md` for what the
  widget and the blog route must not regress.

### 2. Add the return-path shape to `checkoutSchema`

- In `apps/website/src/lib/shared/schemas/booking.ts`, add and export:

  ```ts
  export const blogReturnPathSchema = z
    .string()
    .regex(
      /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Return path must be a root-relative blog post path",
    );
  ```

  The character class is what rejects `//evil.example`, `https://evil.example/`,
  `/booking/room1`, `/blog/a/../b`, `/blog/x?y=1` and a backslash-prefixed
  variant, all without the resolver having to reason about URL parsing.

- Add the field to `checkoutSchema`'s object:

  ```ts
  returnTo: blogReturnPathSchema.nullable().catch(null),
  ```

  `.catch(null)` is deliberate and the comment in the file should say so: a
  forged or malformed return target must not fail a real booking, it must only
  lose the return link. Every other field keeps failing loudly.

- Add a short comment above the field recording that shape is all this schema
  can check - whether the slug exists is a registry question, answered by
  `resolveBlogReturn`.

### 3. Add the shared resolver

- Create `apps/website/src/lib/blog/return-path.ts`:

  ```ts
  import { blogReturnPathSchema } from "@/lib/shared/schemas/booking";
  import { getPostBySlug } from "./posts";

  export const BOOKING_WIDGET_ANCHOR_ID = "book";

  export type BlogReturn = { path: string; href: string; title: string };

  export function resolveBlogReturn(value: string | null | undefined): BlogReturn | null;
  ```

- Behaviour: return `null` unless the value parses against
  `blogReturnPathSchema` **and** `getPostBySlug(slug)` returns a post. On
  success return `{ path, href: `${path}#${BOOKING_WIDGET_ANCHOR_ID}`, title:
post.title }`.
- Write a file-level JSDoc recording the two non-obvious points: this function
  is the only definition of "a valid return target", and it is called at both
  trust boundaries (the Server Action argument and the confirmation page's query
  parameter) because a target validated on the way in is not the same value as
  the one that comes back from Stripe.

### 4. Unit-test the resolver

- Create `apps/website/src/lib/blog/__tests__/return-path.unit.test.ts`.
- `vi.mock("@/lib/blog/posts", ...)` with a `getPostBySlug` that returns a
  fixture post for one known slug and `undefined` otherwise. The mock is not
  optional: the node pool has no MDX plugin, so the real `posts.ts` cannot be
  loaded there.
- Cases: valid slug resolves to path, `#book` href and the post's title;
  `null` and `undefined` resolve to `null`; and each of
  `"https://evil.example/"`, `"//evil.example"`, `"/blog/does-not-exist"`,
  `"/booking/room1"`, `"/blog/a-weekend-in-almocageme?x=1"`,
  `"/blog/../booking/room1"` resolves to `null`.

### 5. Give the widget its anchor

- In `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`, import
  `BOOKING_WIDGET_ANCHOR_ID` and put `id={BOOKING_WIDGET_ANCHOR_ID}` on the
  existing `<aside>`, leaving `data-testid="booking-widget"` and every class
  alone.
- Add a line to the file's JSDoc: the id is the landing target for a return from
  checkout, and a post must therefore render at most one widget.

### 6. Thread `returnTo` through `submitBooking`

- In `apps/website/src/app/(main)/booking/[type]/actions.ts`, change the
  signature to
  `submitBooking(roomType, checkIn, checkOut, source, returnTo: string | null, prevState, formData)`.
  Keep `prevState`/`formData` last: `useActionState` binds them.
- Pass `returnTo` into the `checkoutSchema.safeParse({...})` call alongside
  `source`.
- After validation succeeds, resolve it once:
  `const blogReturn = resolveBlogReturn(validation.data.returnTo);`
- Inside the `try` block that builds `origin`, derive the two URL pieces:

  ```ts
  const returnParam = blogReturn ? `&return=${encodeURIComponent(blogReturn.path)}` : "";
  const cancelUrl = blogReturn ? `${origin}${blogReturn.href}` : `${origin}/booking/${roomType}`;
  ```

  `blogReturn.href` already carries the `#book` anchor, so the cancel URL has
  one definition of "back at the widget".

- In the `stripe.checkout.sessions.create` call, keep the existing
  `eslint-disable-next-line no-secrets/no-secrets` comment directly above the
  `success_url` line and append the interpolation to that same line:

  ```ts
  // eslint-disable-next-line no-secrets/no-secrets -- Stripe URL template placeholder, not a secret
  success_url: `${origin}/booking/confirmation?session={CHECKOUT_SESSION_ID}${returnParam}`,
  cancel_url: cancelUrl,
  ```

  With `returnParam === ""` this is the same string as today, byte for byte.
  Keeping the interpolation short is what stops prettier from reflowing the
  line out from under the disable comment.

- Do not touch `source`, the Stripe `metadata` object, the pending-booking
  insert, or the availability re-check. The originating post is deliberately
  not recorded in the database or in Stripe metadata (out of scope).

### 7. Send the pathname from the client

- In
  `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx`, add
  `usePathname` to the existing `next/navigation` import and read it beside the
  existing `useSearchParams()` call.
- Compute the argument with the same resolver rule the server will re-apply,
  but shape-only (the client has no business importing the post registry):

  ```ts
  const returnTo = blogReturnPathSchema.safeParse(pathname).success ? pathname : null;
  ```

  On `/booking/room1` this is `null`, so that flow is unchanged.

- Pass `returnTo` as the fifth argument of the `submitBooking(...)` call inside
  `runSubmitBooking`.
- Add a brief comment: the value is a hint, not a permission - the server
  revalidates it and checks the slug exists before it reaches Stripe.
- Do not change the PostHog `capture` call. `booking_source` keeps its existing
  value.

### 8. Keep the existing browser test alive

- In
  `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx`,
  extend the `vi.mock("next/navigation", ...)` factory with
  `usePathname: () => mockPathname`, backed by a mutable
  `let mockPathname = "/booking/room1";` reset in `beforeEach`. Without this the
  whole file throws the moment the component calls `usePathname`.
- Add one test to that file asserting the wiring end of it: with
  `mockPathname = "/blog/a-weekend-in-almocageme"`, a submit calls
  `mockSubmitBooking` with that path in the fifth argument position; with the
  default `/booking/room1`, the fifth argument is `null`.
- `RoomSwitcher.browser.test.tsx` and `BookingClient.browser.test.tsx` both stub
  `BookingEngineExpanded` itself, so their `next/navigation` mocks need no
  change. Confirm by running the browser project rather than assuming.

### 9. Extend the Server Action unit tests

- In
  `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts`,
  add `vi.mock("@/lib/blog/posts", ...)` exposing a `getPostBySlug` that knows
  only `a-weekend-in-almocageme`. This keeps the node pool from resolving the
  real registry's `.mdx` imports.
- Update every existing `submitBooking(...)` call site for the new argument
  (pass `null`), so the existing assertions keep testing the same thing.
- New assertions against `mockStripeSessionCreate.mock.calls[0][0]`:
  - `returnTo = "/blog/a-weekend-in-almocageme"` -> `success_url` contains both
    `session={CHECKOUT_SESSION_ID}` and
    `return=%2Fblog%2Fa-weekend-in-almocageme`, and `cancel_url` is
    `http://issebya.com/blog/a-weekend-in-almocageme#book` (the mocked `headers()`
    returns host `issebya.com`, and `NODE_ENV` is not production under vitest, so
    the origin is `http://issebya.com` - assert whatever the existing origin
    handling actually produces rather than hardcoding a guess).
  - `returnTo = null` -> `success_url` is exactly
    `<origin>/booking/confirmation?session={CHECKOUT_SESSION_ID}` and
    `cancel_url` is exactly `<origin>/booking/room1`. Assert equality, not
    `toContain`, so a stray `&return=` fails the test.
  - Negative, one case each for `"https://evil.example/"`, `"//evil.example"`,
    `"/blog/does-not-exist"` and `"/booking/room1"`: the returned state is
    `success: true` with a `url` (the booking is not broken) and the Stripe
    parameters equal the `returnTo = null` values exactly.

### 10. Render the return link on the confirmation page

- In `apps/website/src/app/(main)/booking/confirmation/page.tsx`, widen the
  `searchParams` type to `{ session?: string; return?: string }` and destructure
  `return` (it is a reserved word - alias it, e.g.
  `const { session, return: returnParam } = await searchParams;`).
- Keep the `notFound()` on a missing `session` and the
  `/api/bookings/direct` fetch exactly as they are. The return link is rendered
  from `resolveBlogReturn(returnParam)` only, and must never gate, delay or
  re-run that fetch.
- When it resolves, render, below the existing "48 hours before your arrival"
  paragraph:

  ```tsx
  <Link
    href={blogReturn.href}
    data-testid="return-to-post"
    className="text-sm underline hover:text-gray-600"
  >
    ← back to {blogReturn.title}
  </Link>
  ```

  `underline hover:text-gray-600` is the site's existing link treatment (see
  `mdx-components.tsx`). Use `next/link`, per the repo's routing convention, and
  import it destructured. Copy is lowercase-first to match the site's voice and
  uses no em-dash.

- When it does not resolve, render nothing extra: the page is byte-identical to
  today, with no error and no empty container.

### 11. Extend the Playwright spec

- In `apps/website/e2e/blog-booking-flow.integration.spec.ts`, add a
  `test.describe("Booking confirmation returns to the originating post", ...)`
  block.
- Seed a fixture the way the dates-unavailable test in
  `e2e/booking-flow.integration.spec.ts` does: `createAdminClient()`, a
  `guest_contacts` row with `randomUUID()`-derived phone and email (both columns
  are independently UNIQUE), then a `bookings` row with a known
  `stripe_session_id` (`cs_test_e2e_return_${randomUUID()}`) and
  `status: "confirmed"`.
- Choose the fixture's room and dates to avoid the cross-file collision
  `playwright.config.ts` documents: the suite runs `workers: 1`, and the widget
  booking test in this same file books **room1** on days +10..+13. Seed
  **room2** on days +40..+43 so the fixture never blocks another test's
  calendar.
- `status: "confirmed"` matters: `/api/bookings/direct` only calls Stripe for a
  `pending` row, so a confirmed fixture needs no new MSW handler. If it
  unexpectedly does, add a `GET https://api.stripe.com/v1/checkout/sessions/:id`
  handler returning `payment_status: "paid"` to the existing `E2E_MOCK_STRIPE`
  block in `src/instrumentation.ts` - do not skip the test.
- Inside `try`:
  - Navigate to
    `/booking/confirmation?session=<id>&return=/blog/a-weekend-in-almocageme`.
    Assert the page renders (the "Booking Confirmed" heading is visible), that
    `getByTestId("return-to-post")` is visible, that its text contains
    `A weekend in Almoçageme`, and that its `href` is
    `/blog/a-weekend-in-almocageme#book`.
  - Click it, wait for `**/blog/a-weekend-in-almocageme`, and assert the widget
    (`getByTestId("booking-widget")`) is visible - proving the anchor target
    exists on the post.
  - Negative: navigate to the same URL with
    `return=https://evil.example/`, then with `return=/blog/does-not-exist`.
    Each time assert the "Booking Confirmed" heading is still visible and
    `getByTestId("return-to-post")` has count 0.
- Clean up both seeded rows in `finally`, bookings first, the way the existing
  test does.
- Do not modify the existing "booking completes from inside a post" test, the
  room-switcher tests, the breadcrumb tests, or anything in
  `e2e/booking-flow.integration.spec.ts`.

### 12. Confirm the static shell is intact

- Run `yarn turbo run build --filter=./apps/website` and read the route table.
- `/blog/[slug]` must still be listed as a prerendered (`●`) route with both
  slugs generated, not as a dynamic `ƒ` route. Quote the matching lines in the
  implementation report.
- If it has flipped to dynamic, `usePathname()` is the cause. The fallback is to
  thread the slug down as a prop instead: `/blog/[slug]/page.tsx` already has it
  in scope and can pass it through a small server-rendered context provider
  around `<Content />`, with the widget reading it and handing it to
  `BookingEngine`. Do not reach for `headers()`, `cookies()` or `searchParams`
  in that route under any circumstances.

### 13. Run the validation commands

- Run every command in `Validation Commands` below, from the repository root
  unless stated otherwise, and confirm each exits clean.

## Testing Strategy

### Unit Tests

- **`src/lib/blog/__tests__/return-path.unit.test.ts`** (new): the security
  boundary in isolation. A fixture `getPostBySlug` mock stands in for the post
  registry; the tests pin that a real slug resolves to a path, a `#book` href
  and the post title, and that every hostile or unknown input resolves to
  `null`. This is the cheapest place to prove the open-redirect rule, and it is
  where a future contributor will look first.
- **`src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts`** (extended):
  the Stripe parameters. Positive, `null` and four negative `returnTo` values,
  asserting exact equality for the `null`/rejected cases so a regression that
  leaks `&return=` into a `/booking/[type]` booking fails the suite.
- **`src/schemas/__tests__/booking.unit.test.ts`**: no new test needed. Its
  `validData` fixture omits `returnTo`, and the `.catch(null)` default means it
  keeps passing unchanged - which is itself the regression check that the schema
  change is additive. Run it and confirm.

### Test Coverage

- `apps/website/src/lib/blog/__tests__/return-path.unit.test.ts` (**unit**) -
  catches an open-redirect regression in the one function both trust boundaries
  depend on (`https://evil.example/`, `//evil.example`, an unknown slug, a
  non-blog path). Nothing today validates a return target at all, so every case
  fails without this feature.
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts`
  (**unit**, extended) - catches both halves of the Stripe contract: that a blog
  booking's `success_url` keeps `session={CHECKOUT_SESSION_ID}` _and_ gains the
  encoded return path with a post-anchored `cancel_url`, and that a
  `/booking/[type]` booking's two URLs stay byte-identical to today. The E2E
  layer structurally cannot see this - the MSW mock ignores the request body -
  so this is the only place it can be proved.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx`
  (**browser**, extended) - catches the client half: that the component actually
  sends the pathname when it is a blog post and `null` otherwise. A node test
  cannot reach `usePathname()`; the file is already a browser test with the
  action mocked, so the argument is directly observable there.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts` (**e2e**, extended) -
  catches the user-visible journey the cheaper layers cannot: that
  `/booking/confirmation` with a valid `return` renders a real link with the
  post's title, that following it lands on the post with the widget present, and
  that a forged `return` renders the confirmation with no link and no error.
  This spans two routes, a real database row and a real API route.
- No new browser test for `BookingWidget` - the change there is one static
  attribute with no behaviour, and the E2E test already proves the anchor target
  exists by landing on it.
- No agent-driven `e2e/*.md` journey. Every behaviour here is deterministic and
  assertable with a Playwright spec, which is this project's default.
- `apps/telegram-router`, `apps/guest-communication-agent` and
  `packages/pricing` are untouched by this feature and get no coverage: it is a
  page-navigation change inside `apps/website`, the only workspace with a
  browser surface.

### Edge Cases

- **Absolute URL** (`https://evil.example/`) and **protocol-relative**
  (`//evil.example`, `/\evil.example`) - rejected by the shape regex at both
  boundaries. No redirect, no link, booking unaffected.
- **Well-shaped but unknown slug** (`/blog/does-not-exist`) - passes the regex,
  rejected by `getPostBySlug`. This is why shape validation alone is not enough.
- **Non-blog internal path** (`/booking/room1`, `/api/bookings/direct`) -
  rejected by the regex.
- **Path traversal and query smuggling** (`/blog/../booking/room1`,
  `/blog/slug?x=1`, `/blog/slug#evil`) - rejected by the regex's character
  class.
- **Uppercase or accented slug** - the regex is lowercase-alphanumeric plus
  hyphens, which matches every slug the registry currently defines. A future
  post with a different slug charset would silently lose its return link; the
  resolver's JSDoc should say the regex and the slug convention are coupled.
- **`returnTo` present but `session` missing on the confirmation page** - the
  existing `notFound()` still fires first. The return link never rescues a page
  that has no booking to show.
- **A booking that renders from the Stripe fallback path** (no database row) -
  the return link is independent of the booking fetch, so it renders the same
  way.
- **`/booking/[type]` with a `?source=gca` link** - `usePathname()` is
  `/booking/room1`, `returnTo` is `null`, and `source` still resolves to `"gca"`.
  The two are independent.
- **Cancel from Stripe with no return target** - unchanged: `/booking/<room>`.
- **Two widgets in one post** - duplicate ids; the browser lands on the first.
  Documented in the widget's JSDoc rather than engineered around, since no post
  does this.

## Acceptance Criteria

- Submitting the booking widget from `/blog/a-weekend-in-almocageme` creates a
  Stripe session whose `success_url` contains the literal
  `session={CHECKOUT_SESSION_ID}` **and** `return=%2Fblog%2Fa-weekend-in-almocageme`,
  and whose `cancel_url` is `<origin>/blog/a-weekend-in-almocageme#book`.
- Submitting from `/booking/room1` (or `/booking/room2`) creates a Stripe session
  whose `success_url` and `cancel_url` are byte-identical to today's values, with
  no `return` parameter.
- `source` keeps its `"direct"` / `"gca"` meaning and its PostHog
  `booking_source` value; nothing about it changes.
- `/booking/confirmation?session=<id>&return=/blog/<real-slug>` renders the
  existing confirmation page plus one link, `data-testid="return-to-post"`, whose
  text contains the post's real title and whose `href` is `/blog/<slug>#book`.
- `/booking/confirmation?session=<id>&return=<anything else>` renders exactly
  today's confirmation page: no link, no error, no layout shift.
- A forged or malformed `returnTo` never fails a booking: the action still
  returns `success: true` with a Stripe URL.
- The confirmation page still `notFound()`s without `session`, still derives its
  origin from `headers()`, still fetches `/api/bookings/direct`, and makes no
  additional fetch for the return link.
- `/blog/[slug]` is still listed as a prerendered route in
  `yarn turbo run build --filter=./apps/website`, with both slugs generated.
- The existing "booking completes from inside a post" test and every existing
  `/booking/room1` flow test still pass, unmodified.
- The confirmation email and the Stripe webhook are unchanged; no new column,
  no new Stripe metadata key, no migration.
- `yarn lint`, `yarn typecheck`, `yarn test`, `yarn knip` and
  `yarn workspace website test:integration` are all green.

## Validation Commands

Execute every command to validate the feature works correctly with zero
regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit
  hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace,
  including the preserved `no-secrets/no-secrets` disable on `success_url`
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound: the new
  `submitBooking` argument, the widened `searchParams` type and the resolver's
  return type
- `yarn knip` - No unused files, exports or dependencies were introduced by
  `src/lib/blog/return-path.ts` or the new schema export
- `yarn turbo run test --filter=./apps/website` - Unit tests pass: the new
  resolver suite, the extended `submitBooking` suite, and the untouched
  `checkoutSchema` suite
- `yarn workspace website test:browser --run` - The browser project, which
  `yarn turbo run test` does **not** run (it runs only the `unit` project). This
  proves the `next/navigation` mock update and the new pathname assertion
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and
  the route table still lists `/blog/[slug]` as prerendered. Quote those lines
- `yarn workspace website test:integration` - The Playwright suite, including the
  new confirmation-page tests and the untouched widget/breadcrumb ones

## Notes

- **No new dependency.** Zod, `next/link` and `next/navigation` are all already
  in `apps/website`.
- **No migration, no schema change, no environment variable.** The originating
  post is deliberately not persisted; it lives only in the Stripe URLs for the
  duration of the checkout round trip. Recording it for analytics is explicitly
  out of scope.
- **Two validations of the same value is the point, not duplication.** The
  Server Action validates an argument the browser sent; the confirmation page
  validates a query parameter that came back through a third party and that
  anyone can type by hand. They are different values from different sources that
  happen to look alike. Both go through `resolveBlogReturn` so the rule itself
  exists once.
- **Why `.catch(null)` instead of `.optional()` plus a manual guard.** The issue
  requires that a hostile return target degrade silently rather than fail the
  booking, while the validation stays in `checkoutSchema`. `.catch(null)` is the
  only Zod construct that expresses both at once. Every other field in that
  schema still fails loudly, and the existing schema tests prove it.
- **The `no-secrets` disable comment is load-bearing and fragile.** It is a
  `disable-next-line`, so anything that reflows the `success_url` template
  literal onto another line silently un-suppresses the rule. Keeping the
  appended interpolation to a short `${returnParam}` is what avoids that; run
  prettier and lint before assuming it held.
- **The E2E fixture's room and dates are a deliberate choice, not an arbitrary
  one.** `playwright.config.ts` records two observed cross-file collisions under
  `workers: 1`. Seeding room2 on days +40..+43 keeps the new fixture clear of the
  room1 +10..+13 window the other booking tests use.
- **Prerendering is the one thing that can quietly break here.** The breadcrumb
  feature doc records exactly this hazard for `/blog/[slug]`. `usePathname()` in
  `BookingEngineExpanded` is sanctioned by the issue because that component is
  already a Client Component inside a `<Suspense>` boundary, but the build route
  table is the only real proof; step 12 exists for that, with a prop-threading
  fallback if it does not hold.
- **Left to a human, and worth doing once before this ships:** one test-mode
  booking from the widget on a real Stripe Checkout page, confirming that Stripe
  preserves the extra query parameter on `success_url` and returns the guest to
  `/booking/confirmation?session=cs_…&return=/blog/…`, and that the hosted page's
  cancel button lands on the post at the widget. The pipeline cannot prove
  either: the E2E Stripe mock ignores the request body entirely.
- **Follow-up worth considering, not built here:** the same return-target
  mechanism would let a GCA WhatsApp booking link return the guest to a chosen
  page, and the resolver is shaped so a second allowed prefix could be added
  without touching either call site.
