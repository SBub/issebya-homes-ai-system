# Conditional Documentation

An index of this repository's reference documentation, keyed by **when to read it**.

Agents consult this file before planning or implementing and read only the entries
whose conditions match the task in hand. Reading everything wastes context; reading
nothing repeats mistakes that were already solved and written down here.

`/document` appends an entry to this file whenever it creates new documentation.

## How to use

1. Identify the workspace your change belongs to.
2. Read that workspace's `AGENTS.md` — always, no conditions.
3. Scan the conditions below and read only what matches.
4. Paths are relative to the repository root.

Out of scope for this index: operational runbooks in `docs/*-sop.md` (human
procedures, not code documentation) and anything gitignored.

---

## Always

- `AGENTS.md`
  - Conditions:
    - Before any change, without exception
    - Covers: yarn-only, conventional commits, no `Co-Authored-By`, lefthook, the four-file doc convention

- `README.md`
  - Conditions:
    - When you need the cross-app picture: which app owns what, and how a guest request flows between them

---

## apps/website

- `apps/website/AGENTS.md` — always, for any change under `apps/website/`
- `apps/website/ENGINEERING.md`
  - Conditions:
    - When changing availability, booking persistence, or the iCal merge
    - When you need to know why a page renders the way it does before changing it
    - When you need to know which test layers run in CI and on push, and which are manual

- `apps/website/app_docs/nextjs-patterns-guide.md`
  - Conditions:
    - When adding or changing a route, layout, Server Component, or Server Action
    - When deciding between server and client rendering

- `apps/website/app_docs/data-fetching-client.md`
  - Conditions:
    - When reading data in a Server Component or mutating it in a Server Action
    - When tempted to fetch from a Client Component

- `apps/website/app_docs/component-patterns-guide.md`
  - Conditions:
    - When creating a component, or when the same JSX appears more than once

- `apps/website/app_docs/client-form-guide.md`
  - Conditions:
    - When building or changing any form
    - When using `useActionState`

- `apps/website/app_docs/form-re-render-strategy.md`
  - Conditions:
    - When a form re-renders more than expected, loses input, or feels slow
    - Read alongside `apps/website/app_docs/client-form-guide.md` before changing form state

- `apps/website/app_docs/zod-validation-guide.md`
  - Conditions:
    - When validating input on either side of the wire
    - When adding a schema or changing an existing one

- `apps/website/app_docs/import-patterns-guide.md`
  - Conditions:
    - When adding imports — destructured, not namespace, for tree-shaking

- `apps/website/app_docs/dynamic-url-construction.md`
  - Conditions:
    - When building a URL in an API route or a redirect
    - IMPORTANT: read before hardcoding any base URL

- `apps/website/app_docs/environment-setup.md`
  - Conditions:
    - When adding, renaming, or reading an environment variable

- `apps/website/app_docs/branding-guidelines.md`
  - Conditions:
    - When writing guest-facing copy, or touching brand name, colours, or tone

- `apps/website/app_docs/screenshot-mockup-guidelines.md`
  - Conditions:
    - When an issue arrives with a screenshot or mockup attached

- `apps/website/app_docs/database/database-interaction-rules.md`
  - Conditions:
    - When reading from or writing to the database
    - When adding a table, column, or query
    - IMPORTANT: read before writing any migration

- `apps/website/app_docs/database/production-migrations.md`
  - Conditions:
    - When a schema change has to reach production
    - When changing `.github/workflows/migrations.yml`
    - When adding or changing a required status check on `master`
    - When a prod migration apply has failed, or prod and `master` disagree about
      which migrations are applied

- `apps/website/app_docs/testing/unit_test_spec_format.md`
  - Conditions:
    - When writing or specifying a unit test

- `apps/website/app_docs/testing/component_test_spec_format.md`
  - Conditions:
    - When writing or specifying a component test

- `apps/website/app_docs/testing/e2e_example.md`
  - Conditions:
    - When adding a Playwright spec under `apps/website/e2e/`
    - Note: `apps/website/app_docs/testing/e2e_runner.md` describes an agent-driven MCP browser flow that this repo does not currently use — prefer the code-based Playwright specs

- `apps/website/app_docs/feature-2365c303-drop-hardcoded-reviews.md`
  - Conditions:
    - When touching the booking type page's review/testimonial section
    - When tempted to re-add a reviews carousel or hardcoded review data for a room
    - When adding a new outbound listing link and looking for the established inline-anchor style

- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md`
  - Conditions:
    - When changing the `<Suspense>` boundary or fallback around `BookingEngine` in `booking/[type]/page.tsx`
    - When changing `BookingClient`'s collapsed-state DOM/classes and needing to know what else must stay visually in sync
    - When tempted to skeleton `BookingPricing` or use interactive elements for a loading placeholder

- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`
  - Conditions:
    - When adding, editing or removing a blog post under `apps/website/src/content/blog/`
    - When changing `BookingWidget`, `RoomSwitcher`, or anything that renders `BookingEngine` outside `/booking/[type]`
    - When a blog route stops prerendering, or `sitemap.ts`/`robots.ts`/`SITE_URL` needs changing
    - When a local or E2E iCal feed fetch fails on a non-3000 port

- `apps/website/app_docs/feature-e259222e-room-switcher-calendar-reset.md`
  - Conditions:
    - When changing how `RoomSwitcher` renders or swaps its tab panel, or when tempted to drop the `key` on it
    - When a UI control changes `aria-selected` or a label but the component underneath keeps showing the previous selection's data
    - When adding state to `BookingClient` or `BookingCalendar` that is seeded from props on mount only
    - When writing a browser test that needs the real `BookingClient` without pulling in the `submitBooking` Server Function

- `apps/website/app_docs/feature-437bcd03-blog-breadcrumb-trail.md`
  - Conditions:
    - When changing the breadcrumb on `/blog/[slug]`, or adding one to another route
    - When adding navigation UI that is tempted to read the current URL with `usePathname()` inside a prerendered route
    - When a `*.browser.test.tsx` fails at import time on `next/link` (`process is not defined`)

- `apps/website/app_docs/feature-4d0d9d75-blog-booking-return-link.md`
  - Conditions:
    - When changing `submitBooking`'s arguments, or the `success_url` / `cancel_url` it sends to Stripe
    - When adding or validating any user-supplied redirect or return target (open-redirect surface)
    - When changing what `/booking/confirmation` reads from `searchParams`, or the widget's `#book` anchor
    - When a blog post slug convention changes, or `BookingEngineExpanded` gains another `next/navigation` hook

- `apps/website/app_docs/feature-39f3d713-booking-link-dates-notice.md`
  - Conditions:
    - When changing `resolveInitialCheckDates`, or anything that decides whether a `?checkIn=`/`?checkOut=` URL range is applied
    - When a guest reports that a GCA booking link opened on dates they did not agree to, or on the wrong month
    - When adding a second `role="status"` node inside `.booking-engine`, or changing which month `BookingCalendar` opens on

- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md`
  - Conditions:
    - When a `*.browser.test.tsx` passes locally but fails in CI with `Vitest failed to find the runner`, or a `new dependencies optimized` line appears in the run
    - When changing the website's `test` / `test:browser` scripts, `browser.instances`, or `optimizeDeps.include` in `vitest.config.ts`
    - When deciding whether a new test should gate, or wondering why an `e2e/` spec never runs in CI

- `apps/website/app_docs/feature-f72316fa-booking-og-metadata.md`
  - Conditions:
    - When a WhatsApp (or other) link preview for a `/booking/[type]` URL shows the home card, the wrong room, or no image
    - When changing `generateMetadata` on `/booking/[type]`, adding a room, or replacing a `public/og/booking-*.jpg` share image
    - When `/booking/room1` or `/booking/room2` stops showing as prerendered in the build route table

- `apps/website/app_docs/feature-78e55892-booking-close-scroll-target.md`
  - Conditions:
    - When changing where `BookingClient` scrolls on expand or close, or adding a sticky/fixed header that could cover `.booking-engine`
    - When opening or closing the booking calendar leaves the guest at the page top, the gallery, or the top of a blog post instead of the date row
    - When a Playwright assertion after a smooth scroll passes or fails regardless of where the page ends up

- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md`
  - Conditions:
    - When replacing the sample products or images, or adding a field to the product schema in `src/lib/shop/`
    - When changing `ProductCard` sizing, or the card stops being portrait or its photo collapses at some breakpoint
    - When changing the shared `src/app/ui/Breadcrumb.tsx` or adding another detail route that needs a back trail

- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`
  - Conditions:
    - When changing the wishlist form, its consent copy, or the `shop_wishlist_contacts` / `shop_wishlist_items` tables
    - When renaming a product slug, or building anything that emails wishlist contacts (unsubscribe, offers)
    - When a wishlist save fails, stores a duplicate, or `/shop/[slug]` stops being prerendered or hits a hydration mismatch

- `apps/website/app_docs/feature-7d77143c-shop-seller-submission-form.md`
  - Conditions:
    - When changing the `/shop/sell` form, its Server Actions, or the `shop_seller_submissions` table / `seller-submissions` bucket
    - When adding another browser-to-Supabase-Storage upload, or when an upload fails on a CSP `connect-src` block
    - When a seller submission is saved but the owner email never arrives, or a finalize is refused over photo paths

- `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md`
  - Conditions:
    - When changing the wishlist heart button, its `<dialog>`, or the confirmation panel on `/shop/[slug]`
    - When changing the guest wishlist confirmation email, or when it is sent twice or never arrives
    - When adding another modal dialog to the site (scroll lock, backdrop-click and focus-return patterns)

- `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md`
  - Conditions:
    - When changing the wishlist unsubscribe route, `unsubscribe_token`, or the `shop_wishlist_contacts_consent_state` CHECK
    - When changing the wishlist confirmation email's footer or headers (`List-Unsubscribe`)
    - When building any send to wishlist contacts, or when an unsubscribe link fails or leaks its token

---

## apps/guest-communication-agent

- `apps/guest-communication-agent/AGENTS.md` — always, for any change under that app
- `apps/guest-communication-agent/README.md`
  - Conditions:
    - When you need the stack and what the agent is responsible for

- `apps/guest-communication-agent/ENGINEERING.md`
  - Conditions:
    - When changing the agent loop, a tool, memory, or retrieval
    - When touching a human-in-the-loop gate or an Inngest function
    - IMPORTANT: read before changing anything that can suspend a run

- `apps/guest-communication-agent/app_docs/feature-9e5b865a-dev-gateway-tunnel-adoption.md`
  - Conditions:
    - When `yarn dev` fails on startup with `ERR_NGROK_334`, or tears down `next dev`/`inngest dev` because a shared process it did not own exited
    - When changing `apps/guest-communication-agent/scripts/dev.ts`, or anything about which processes `yarn dev` spawns, adopts, or signals on Ctrl-C
    - When running `yarn dev` and `yarn dev:adw` at the same time, or wondering why one leaves the other's gateway and tunnel alone

- `apps/guest-communication-agent/app_docs/feature-d7d0c40c-reject-past-dates-booking.md`
  - Conditions:
    - When adding or changing a tool that takes a `checkIn`/`checkOut` pair, before re-deriving its own date checks instead of importing `validateStayRange`
    - When a tool result has to refuse the model's arguments, and you need the shape that reaches the model without tripping `detectToolSoftFailure`
    - When editing the `checkAvailability` mirror inside `sandbox.ts`'s `buildScript`, where an untagged template literal silently eats `\d`
    - When `send_booking_link` resolves as not approved without the owner ever seeing a Telegram nudge

- `apps/guest-communication-agent/app_docs/feature-4f43c209-turn-message-replay.md`
  - Conditions:
    - When changing how history is loaded, grouped, trimmed or redacted in `memory.ts`/`context.ts`, or what `record-reply` stores in `whatsapp_messages.turn_messages`
    - When the agent forgets a fact (dates, price, availability) that a tool returned in an earlier turn, or a provider rejects history with a 400 over an orphaned tool-call
    - When adding a golden eval row that replays stored `whatsapp_messages` rows, or using `GCA_EVAL_DISABLE_TURN_REPLAY`

---

## apps/telegram-router

- `apps/telegram-router/AGENTS.md`
  - Conditions:
    - Always, for any change under that app
    - Covers the two correlation mechanisms, the two auth mechanisms, the always-200 rule, and why there is no dedup check
    - IMPORTANT: this app deliberately has no ENGINEERING file. It is a thin dispatcher of eight source files; the README covers the routes and the source carries file-level walkthroughs in its JSDoc

- `apps/telegram-router/README.md`
  - Conditions:
    - When changing either route, or when you need the correlation-id scheme

---

## packages/pricing

- `packages/pricing/AGENTS.md` — always, for any change under that package
- `packages/pricing/README.md`
  - Conditions:
    - When anything reads or changes a price, a tourist tax, or a fee
    - This package is one exported constant; read the README rather than guessing at the shape

---

## Cross-cutting constraints

- `scripts/dev-webhook-gateway.ts` (read the file header)
  - Conditions:
    - IMPORTANT: before changing any app's port, or adding an inbound webhook
    - One reserved ngrok hostname fronts the gateway on 3010 and routes by path prefix to 3005 and 3003. Ports 3003 and 3005 are a contract with Twilio and Telegram and must not move
    - `apps/website` (3000) is NOT part of that contract — the gateway has no route to it. It defaults to 3000 but follows `PORT`, so an ADW run can give each worktree its own server instead of sharing the developer's. See `apps/website/playwright.config.ts`

- `supabase/config.toml`
  - Conditions:
    - When changing local database configuration
    - The repository runs a single shared local database. Never plan a reset
