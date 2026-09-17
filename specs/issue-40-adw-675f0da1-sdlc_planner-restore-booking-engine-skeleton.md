# Chore: Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine

## Metadata

issue_number: `40`
adw_id: `675f0da1`
issue_json: `{"number":40,"title":"Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine","body":"## Context\n\n`BookingEngineSkeleton.tsx` was removed in #39 (`67c3ca7 refactor(website): convert booking engine and checkout to Server Components/Actions, drop React Query`) because its only use was as the `isLoading`fallback for the old client-side`useAvailabilityQuery`(React Query) hook, which no longer exists —`BookingEngine` is now a cached async Server Component.\n\nThe skeleton markup itself was good and shouldn't be lost.\n\n## Opportunity\n\n`apps/website/src/app/(main)/booking/[type]/page.tsx`currently wraps`<BookingEngine>`in`<Suspense fallback={null}>`— so while the cached`getAvailability`call resolves (a genuine cache miss, or streaming under Partial Prerendering), the guest sees nothing at all where the booking widget will appear.\n\nBringing this skeleton back as that Suspense boundary's`fallback`(instead of`null`) would give a real loading state for that gap, instead of a blank space. It would need a small adjustment since the shape of `BookingEngine`'s output changed since this skeleton was written (it now renders through `BookingClient`, not the old `BookingEngineCollapsed`/`BookingEngineExpanded`split) — worth checking the current DOM/class structure lines up, or updating the skeleton to match.\n\n## Suggestion\n\nRe-add a skeleton component (based on the markup above) and wire it in as`<Suspense fallback={<BookingEngineSkeleton />}>`in`page.tsx`."}`

## Chore Description

Restore a `BookingEngineSkeleton` component (previously deleted in `67c3ca7`) and wire it in as the `fallback` of the `<Suspense>` boundary that wraps `<BookingEngine>` in `apps/website/src/app/(main)/booking/[type]/page.tsx`. Today that boundary uses `fallback={null}`, so a cache miss or PPR streaming gap renders a blank space where the booking widget belongs. A skeleton gives the guest a real, non-jumpy loading placeholder instead.

The old skeleton (deleted alongside the React-Query removal) rendered a collapsed-state approximation: a `.booking-engine` wrapper containing a pulsing pair of "check-in"/"check-out" date placeholders plus the real `BookingPricing`. Since then, `BookingClient` (the current collapsed-state renderer) added a third element to that row — the `book` button — inside `.booking-dates-display`, so the old two-cell skeleton no longer matches the live layout's width/shape. The restored skeleton must mirror the _current_ three-cell layout (check-in, check-out, book) to minimize layout shift when the real content swaps in, reusing the same CSS classes (`booking-engine`, `booking-engine-collapsed`, `booking-collapsed-main`, `booking-dates-display`, `booking-date-value`, `booking-date-separator`) already defined in `globals.css`, plus the real `BookingPricing` component underneath (it's static, cache-free content — no need to skeleton it).

## Relevant Files

Use these files to resolve the chore:

- `apps/website/src/app/(main)/booking/[type]/page.tsx` - owns the `<Suspense fallback={null}>` boundary around `<BookingEngine>` that needs to change to `fallback={<BookingEngineSkeleton />}`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx` - the async Server Component the Suspense boundary wraps; confirms why no boundary is needed inside it and what `BookingClient`'s collapsed output looks like when it resolves.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - current source of truth for the collapsed-state DOM the skeleton must visually match (lines ~196-239: `.booking-engine` > `.booking-engine-collapsed` > `.booking-collapsed-main` > `.booking-dates-display` with two date buttons + separator + book button, then `{pricing}` below).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingPricing.tsx` - static, non-cached presentational component (price/night + cancellation notice); reused as-is (not skeletonized) inside the new skeleton, same as the original.
- `apps/website/src/app/globals.css` (lines ~44-80) - defines `.booking-engine`, `.booking-engine-collapsed`, `.booking-collapsed-main`, `.booking-dates-display`, `.booking-date-button`, `.booking-date-value`, `.booking-date-separator`, `.booking-book-button`, `.booking-pricing-info`; the skeleton must reuse these rather than inventing new classes, plus Tailwind's `animate-pulse` for the loading effect.
- `apps/website/AGENTS.md` - "Server components by default, `'use client'` only when the browser must handle state" — the skeleton has no state or interactivity, so it must be a plain Server Component (no `"use client"` directive), matching the original.
- `apps/website/app_docs/component-patterns-guide.md` - DRY/component-extraction conventions to follow for the new file.
- `apps/website/app_docs/testing/component_test_spec_format.md` - confirms `*.browser.test.tsx` is the right layer for a synchronous, non-async component render check.

### New Files

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` - the restored skeleton component, updated to match the current three-cell collapsed layout.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx` - smoke test asserting the skeleton renders the expected structure.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Re-create `BookingEngineSkeleton`

- Create `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` as a plain (non-`"use client"`) Server Component exporting `BookingEngineSkeleton`.
- Reuse the real `BookingPricing` component underneath, exactly as the original did — it's static copy, not loading-dependent, so it never needs a pulsing placeholder.
- Structure the placeholder row to match `BookingClient`'s current three-cell `.booking-dates-display` (check-in cell, `→` separator, check-out cell, `book` cell) instead of the old two-cell version, so swapping in the resolved `BookingClient` output causes minimal layout shift:
  - Wrap everything in `<div className="booking-engine">` > `<div className="booking-engine-collapsed">` > `<div className="booking-collapsed-main">`.
  - Inside, `<div className="booking-dates-display animate-pulse">` containing:
    - A muted check-in placeholder cell (reuse `.booking-date-button`/`.booking-date-value` classes with a muted text color, e.g. `text-gray-400`, and neutral border e.g. `border-gray-300`, as the original did, so it reads as inactive rather than a real clickable button).
    - `<span className="booking-date-separator text-gray-300">→</span>`.
    - A muted check-out placeholder cell, same treatment.
    - A muted `book`-button-shaped placeholder cell (new vs. the original, needed to match the current three-cell row so the row width doesn't jump when real content loads) — reuse `.booking-book-button`'s box shape but with muted colors (e.g. `bg-gray-300 text-gray-400`) rather than the real dark button, since nothing is clickable yet.
  - `<BookingPricing />` below, outside the pulsing row (unchanged from the original).
- Do not use real interactive elements (`<button>`) for the placeholders — use non-interactive `<div>`/`<span>` as the original did, since nothing is clickable while loading.

### 2. Wire the skeleton into the Suspense boundary

- In `apps/website/src/app/(main)/booking/[type]/page.tsx`, import `BookingEngineSkeleton` from `./ui/BookingEngineSkeleton`.
- Change `<Suspense fallback={null}>` to `<Suspense fallback={<BookingEngineSkeleton />}>` around `<BookingEngine roomType={roomType} />`.

### 3. Add the component test

- Create `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx` (see `Test Coverage` below for what it asserts).

### 4. Validate

- Run the `Validation Commands` below and fix anything they surface.

## Test Coverage

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx` (`*.browser.test.tsx`, Vitest browser mode) - renders `<BookingEngineSkeleton />` in isolation and asserts: the pulsing dates row is present (query by the `animate-pulse` container or a `data-testid`), it contains three placeholder cells (check-in, check-out, book), and the real `BookingPricing` content (e.g. the "per night" price text) renders underneath. This fails without the change because the component does not exist yet, and it pins the three-cell shape called for in this chore (a regression to the old two-cell layout, or a typo dropping `BookingPricing`, would fail it).
- No test is added for the `Suspense fallback` wiring change in `page.tsx` itself: triggering the fallback deterministically requires a genuine cache-miss/streaming race that neither `*.unit.test.ts`, `*.browser.test.tsx`, nor a Playwright spec can reliably force (the cached `getAvailability` call typically resolves before Playwright's DOM snapshot, and forcing an artificial delay would test the delay, not this wiring). The component test above covers the only genuinely fragile part (the markup matching the live layout); the `fallback={...}` prop itself is a one-line, statically-typed JSX change that `tsc` already guards.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=website` - Unit and component tests pass, including the new `BookingEngineSkeleton.browser.test.tsx`
- `yarn turbo run build --filter=website` - Production build succeeds

## Notes

- The skeleton must stay a Server Component (no `"use client"`): it has no state, no event handlers, and per `apps/website/AGENTS.md` client components are only for browser-side state. This also keeps it usable directly as a `Suspense` `fallback` from another Server Component (`page.tsx`) with no client/server boundary friction.
- Keep placeholders as non-interactive elements (`<div>`/`<span>`), not `<button>`, so nothing appears clickable while `BookingEngine` is still resolving.
- Don't try to skeleton `BookingPricing` — it's static copy sourced from the `pricing` package, not from the awaited `getAvailability` call, so it's already correct the instant it renders; the original skeleton made the same choice.
