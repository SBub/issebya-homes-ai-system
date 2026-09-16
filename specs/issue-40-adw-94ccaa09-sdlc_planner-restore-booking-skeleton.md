# Chore: Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine

## Metadata

issue_number: `40`
adw_id: `94ccaa09`
issue_json: `{"number":40,"title":"Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine","body":"## Context\n\n`BookingEngineSkeleton.tsx` was removed in #39 (`67c3ca7 refactor(website): convert booking engine and checkout to Server Components/Actions, drop React Query`) because its only use was as the `isLoading`fallback for the old client-side`useAvailabilityQuery`(React Query) hook, which no longer exists —`BookingEngine` is now a cached async Server Component.\n\nThe skeleton markup itself was good and shouldn't be lost. For reference, here's what was removed:\n\n```tsx\nimport { BookingPricing } from \"./BookingPricing\";\n\nexport function BookingEngineSkeleton() {\n  return (\n    <div className=\"booking-engine\">\n      <div className=\"booking-engine-collapsed\">\n        <div className=\"booking-collapsed-main\">\n          <div className=\"booking-dates-display animate-pulse\">\n            <div className=\"px-3 py-2 border border-gray-300 bg-background\">\n              <span className=\"booking-date-value text-gray-400\">check-in</span>\n            </div>\n\n            <span className=\"booking-date-separator text-gray-300\">→</span>\n\n            <div className=\"px-3 py-2 border border-gray-300 bg-background\">\n              <span className=\"booking-date-value text-gray-400\">check-out</span>\n            </div>\n          </div>\n\n          <BookingPricing />\n        </div>\n      </div>\n    </div>\n  );\n}\n```\n\n## Opportunity\n\n`apps/website/src/app/(main)/booking/[type]/page.tsx`currently wraps`<BookingEngine>`in`<Suspense fallback={null}>`— so while the cached`getAvailability`call resolves (a genuine cache miss, or streaming under Partial Prerendering), the guest sees nothing at all where the booking widget will appear.\n\nBringing this skeleton back as that Suspense boundary's`fallback`(instead of`null`) would give a real loading state for that gap, instead of a blank space. It would need a small adjustment since the shape of `BookingEngine`'s output changed since this skeleton was written (it now renders through `BookingClient`, not the old `BookingEngineCollapsed`/`BookingEngineExpanded`split) — worth checking the current DOM/class structure lines up, or updating the skeleton to match.\n\n## Suggestion\n\nRe-add a skeleton component (based on the markup above) and wire it in as`<Suspense fallback={<BookingEngineSkeleton />}>`in`page.tsx`."}`

## Chore Description

`BookingEngineSkeleton.tsx` was deleted in #39 when the booking engine moved from a
client-side `useAvailabilityQuery` (React Query) hook to a cached async Server
Component (`BookingEngine`). At the time, its only caller — the query's `isLoading`
branch — went away with it, so the file was removed rather than orphaned.

Today `apps/website/src/app/(main)/booking/[type]/page.tsx` wraps `<BookingEngine>`
in `<Suspense fallback={null}>`. `BookingEngine` calls `getAvailability`, a
`"use cache"`-tagged function (`cacheLife("minutes")`); on a cache miss, or when the
page streams under Partial Prerendering, React suspends and the guest sees a blank
gap where the booking widget belongs until the cache resolves.

This chore re-adds `BookingEngineSkeleton` as that boundary's fallback, so the gap
renders a loading placeholder instead of nothing. The skeleton's markup must be
brought up to date with the DOM `BookingClient` (the component `BookingEngine`
now renders through) actually produces today, which differs from the shape the
original skeleton was written against:

- The original skeleton nested `<BookingPricing />` **inside**
  `.booking-collapsed-main`, alongside the date cells. In the current
  `BookingClient`, `{pricing}` is a sibling of `.booking-engine-collapsed`,
  not nested inside `.booking-collapsed-main` — it renders after that div
  closes, at the top level of `.booking-engine`.
- The current collapsed state has **three** controls inside
  `.booking-dates-display`: a check-in button, a check-out button, and a
  `.booking-book-button` ("book"). The original skeleton only placeholdered
  the two date cells (no book-button placeholder existed yet when it was
  written).

The skeleton stays presentational only: non-interactive placeholder elements
(`div`/`span`, not `button`) with `animate-pulse`, mirroring the real structure
closely enough that the loading -> loaded transition doesn't visibly shift layout.

## Relevant Files

Use these files to resolve the chore:

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - source of
  truth for the current collapsed-state DOM structure (`.booking-engine` >
  `.booking-engine-collapsed` > `.booking-collapsed-main` > `.booking-dates-display`
  with three controls, then `{pricing}` as a sibling of `.booking-engine-collapsed`).
  The skeleton must mirror this shape.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx` - the async
  Server Component the new Suspense boundary is waiting on; confirms `BookingEngine`
  itself has no loading state of its own (per its own comment, it's cached and
  doesn't need one — the boundary above it is what needs the fallback).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingPricing.tsx` - the
  pricing block rendered inside the real component; the skeleton reuses it
  directly (as the original did) rather than re-implementing a placeholder for it.
- `apps/website/src/app/(main)/booking/[type]/page.tsx` - has the
  `<Suspense fallback={null}>` boundary (line 96) that needs to become
  `<Suspense fallback={<BookingEngineSkeleton />}>`, plus the import to add.
- `apps/website/src/app/globals.css` (lines 39-96) - defines `.booking-engine`,
  `.booking-engine-collapsed`, `.booking-collapsed-main`, `.booking-dates-display`,
  `.booking-date-value`, `.booking-date-separator`, `.booking-book-button`,
  `.booking-pricing-info` etc. The skeleton reuses these class names for layout
  but intentionally does not use `.booking-date-button`/`.booking-book-button`
  styling for its placeholder cells (those are interactive-control styles; the
  original skeleton used plain gray placeholder styling instead, consistent
  with it being non-interactive).
- `apps/website/AGENTS.md` - Next.js conventions for this app (server components
  by default, no client directive needed here).
- `apps/website/app_docs/component-patterns-guide.md` - co-location rule: a
  component used by a single feature folder stays co-located
  (`booking/[type]/ui/`), which is where the file is being re-added.
- `apps/website/app_docs/import-patterns-guide.md` - destructured imports only.

### New Files

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` -
  the re-added skeleton component, updated to match the current DOM shape.

## Step by Step Tasks

### 1. Re-create `BookingEngineSkeleton.tsx`

- Add `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx`,
  a synchronous Server Component (no `"use client"`, no props).
- Structure it to match `BookingClient`'s collapsed-state DOM exactly:
  - `.booking-engine` > `.booking-engine-collapsed` > `.booking-collapsed-main` >
    `.booking-dates-display` (add `animate-pulse` here, as the original did).
  - Inside `.booking-dates-display`, three placeholder cells to match
    `BookingClient`'s three controls: check-in, the `.booking-date-separator`
    (`→`), check-out, and a third placeholder for the book button. Use
    non-interactive `div`/`span` elements (not `button`), keeping the original's
    muted placeholder styling (`border-gray-300`/`text-gray-400` or equivalent)
    rather than the real `.booking-date-button`/`.booking-book-button` classes,
    since those imply interactivity the skeleton doesn't have.
  - Render `<BookingPricing />` as a **sibling** of `.booking-engine-collapsed`
    (inside `.booking-engine`, after it), not nested inside
    `.booking-collapsed-main` — matching where `{pricing}` actually renders in
    `BookingClient` today, not where the pre-#39 skeleton put it.
- Import `BookingPricing` via the existing relative import (`./BookingPricing`),
  consistent with same-feature-folder import conventions.

### 2. Wire the skeleton into the Suspense boundary

- In `apps/website/src/app/(main)/booking/[type]/page.tsx`:
  - Add `import { BookingEngineSkeleton } from "./ui/BookingEngineSkeleton";`.
  - Change `<Suspense fallback={null}>` (line 96) to
    `<Suspense fallback={<BookingEngineSkeleton />}>`.

### 3. Validate

- Run the `Validation Commands` below and confirm all pass with zero regressions.

## Test Coverage

No test needed: `BookingEngineSkeleton` is a static, prop-less Server Component —
no branches, no state, no user interaction, nothing that varies by input. Per
`apps/website/app_docs/testing/component_test_spec_format.md`, component tests
exist to cover props handling, local state, user interactions and conditional
rendering, and explicitly exclude CSS-class assertions and async Server
Components; a skeleton with none of the former and being exactly the latter has
nothing in that category to exercise. A test that only pinned the static markup
or class names would be a brittle snapshot of implementation detail, not a
regression guard — the thing that could actually break here (the Suspense
fallback wiring, or `getAvailability` genuinely suspending) is not something a
`*.browser.test.tsx` or `*.unit.test.ts` can observe in isolation, and does not
rise to the level of needing a new Playwright spec: this is a purely visual
loading-state affordance with no assertable functional behavior, not a new
user-visible flow.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=website` - Lint passes for the website workspace
- `yarn turbo run typecheck --filter=website` - Types are sound for the website workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (confirms `BookingEngineSkeleton` is actually wired in, not dead code)
- `yarn turbo run test --filter=website` - Existing unit/component tests still pass
- `yarn turbo run build --filter=website` - Production build succeeds

## Notes

- This does not touch `BookingEngine.tsx` itself — per its own comment, it's a
  cached call and doesn't need its own Suspense boundary; the fallback lives one
  level up, at the call site in `page.tsx`, which already has the boundary and
  just needs a real fallback instead of `null`.
- The `.booking-engine-loading` CSS class in `globals.css` (line 45) already
  exists but has been unused since #39 predates it having a caller in JSX.
  This chore does not need it: the original skeleton (and this one) style the
  loading state via `animate-pulse` plus per-element placeholder classes, not
  via `.booking-engine-loading`. Leave that class alone — removing unrelated
  dead CSS is out of scope for this chore.
