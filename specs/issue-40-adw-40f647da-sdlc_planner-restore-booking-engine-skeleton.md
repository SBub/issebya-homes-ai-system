# Chore: Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine

## Metadata

issue_number: `40`
adw_id: `40f647da`
issue_json: `{"number":40,"title":"Reuse BookingEngineSkeleton as the Suspense fallback for BookingEngine","body":"## Context\n\n`BookingEngineSkeleton.tsx` was removed in #39 (`67c3ca7 refactor(website): convert booking engine and checkout to Server Components/Actions, drop React Query`) because its only use was as the `isLoading`fallback for the old client-side`useAvailabilityQuery`(React Query) hook, which no longer exists —`BookingEngine` is now a cached async Server Component.\n\nThe skeleton markup itself was good and shouldn't be lost. For reference, here's what was removed:\n\n```tsx\nimport { BookingPricing } from \"./BookingPricing\";\n\nexport function BookingEngineSkeleton() {\n  return (\n    <div className=\"booking-engine\">\n      <div className=\"booking-engine-collapsed\">\n        <div className=\"booking-collapsed-main\">\n          <div className=\"booking-dates-display animate-pulse\">\n            <div className=\"px-3 py-2 border border-gray-300 bg-background\">\n              <span className=\"booking-date-value text-gray-400\">check-in</span>\n            </div>\n\n            <span className=\"booking-date-separator text-gray-300\">→</span>\n\n            <div className=\"px-3 py-2 border border-gray-300 bg-background\">\n              <span className=\"booking-date-value text-gray-400\">check-out</span>\n            </div>\n          </div>\n\n          <BookingPricing />\n        </div>\n      </div>\n    </div>\n  );\n}\n```\n\n## Opportunity\n\n`apps/website/src/app/(main)/booking/[type]/page.tsx`currently wraps`<BookingEngine>`in`<Suspense fallback={null}>`— so while the cached`getAvailability`call resolves (a genuine cache miss, or streaming under Partial Prerendering), the guest sees nothing at all where the booking widget will appear.\n\nBringing this skeleton back as that Suspense boundary's`fallback`(instead of`null`) would give a real loading state for that gap, instead of a blank space. It would need a small adjustment since the shape of `BookingEngine`'s output changed since this skeleton was written (it now renders through `BookingClient`, not the old `BookingEngineCollapsed`/`BookingEngineExpanded`split) — worth checking the current DOM/class structure lines up, or updating the skeleton to match.\n\n## Suggestion\n\nRe-add a skeleton component (based on the markup above) and wire it in as`<Suspense fallback={<BookingEngineSkeleton />}>`in`page.tsx`."}`

## Chore Description

`BookingEngineSkeleton.tsx` was removed in #39 when the booking engine moved from a client-side `useAvailabilityQuery` (React Query) hook to a cached async Server Component (`BookingEngine`). Its only caller at the time was that hook's `isLoading` fallback, which no longer exists, so the file was deleted along with it.

`apps/website/src/app/(main)/booking/[type]/page.tsx` still wraps `<BookingEngine>` in `<Suspense fallback={null}>`. Whenever that Suspense boundary actually has to wait (a genuine `getAvailability` cache miss, or streaming under Partial Prerendering), the guest currently sees nothing where the booking widget will appear.

This chore re-creates `BookingEngineSkeleton` from the markup preserved in the issue body, adjusts it to match the DOM structure `BookingClient` renders today (the skeleton predates the `BookingClient`/`BookingEngineExpanded` split and nested `BookingPricing` one level too deep), and wires it in as the real `fallback` for that `Suspense` boundary.

### The structural adjustment needed

The old skeleton nested `<BookingPricing />` inside `.booking-collapsed-main`, alongside `.booking-dates-display`:

```
.booking-engine
  .booking-engine-collapsed
    .booking-collapsed-main
      .booking-dates-display (+ BookingPricing nested here)
```

`BookingClient.tsx` (the current collapsed-state owner) renders `BookingPricing` as a sibling of `.booking-engine-collapsed`, directly under `.booking-engine`, not nested inside `.booking-collapsed-main`:

```tsx
<div className="booking-engine">
  <div className="booking-engine-collapsed">
    <div className="booking-collapsed-main">
      <div className="booking-dates-display">...</div>
    </div>
  </div>

  {pricing}

  {isExpanded && <BookingEngineExpanded ... />}
</div>
```

(see `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx:196-253`). The skeleton must move `<BookingPricing />` out of `.booking-collapsed-main` to match, otherwise the loading state and loaded state would visually reflow when the real content swaps in. No other structural change is needed — the two check-in/check-out placeholder cells plus separator still line up with what `BookingClient` renders in its collapsed date-display row.

## Relevant Files

Use these files to resolve the chore:

- `apps/website/src/app/(main)/booking/[type]/page.tsx` — owns the `<Suspense fallback={null}>` boundary around `<BookingEngine>` (lines 96-98) that needs the real fallback wired in, and the `./ui/BookingEngine` import style to mirror for the new import.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` — current source of truth for the collapsed-state DOM structure (lines 196-253); the skeleton must mirror this shape, including where `pricing` sits relative to `.booking-engine-collapsed`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingPricing.tsx` — the small server component the skeleton renders unconditionally (pricing doesn't depend on availability data, so it isn't part of the loading gap).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx` — the async Server Component this Suspense boundary is waiting on; confirms there's no other output shape to account for.
- `apps/website/src/app/globals.css` (lines 41-95) — defines `.booking-engine`, `.booking-engine-collapsed`, `.booking-collapsed-main`, `.booking-dates-display`, `.booking-date-value`, `.booking-date-separator`, `.booking-pricing-info`; confirms the class names the skeleton reuses still exist and still mean what the skeleton assumes.
- `apps/website/AGENTS.md` — Next.js conventions for this workspace (server components by default, no Radix UI, calendar-day string handling — not relevant here since the skeleton has no dates logic, but confirms no `'use client'` is needed).
- `apps/website/app_docs/component-patterns-guide.md` — co-location rule: single-feature components stay in the feature's own `ui/` folder (this component is only ever used by `booking/[type]/page.tsx`, so it belongs next to `BookingEngine.tsx`, not in `src/app/ui/`).
- `apps/website/app_docs/nextjs-patterns-guide.md` — server-components-by-default guidance; this component has no state/effects/handlers, so it stays a plain Server Component like `BookingPricing`.

### New Files

- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` — the re-created skeleton component.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Re-create `BookingEngineSkeleton`

- Create `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` as a plain Server Component (no `'use client'`, matching `BookingPricing.tsx`'s pattern), based on the markup from the issue body but with `<BookingPricing />` moved to be a sibling of `.booking-engine-collapsed` (a direct child of the outer `.booking-engine` div), not nested inside `.booking-collapsed-main`:

```tsx
import { BookingPricing } from "./BookingPricing";

export function BookingEngineSkeleton() {
  return (
    <div className="booking-engine">
      <div className="booking-engine-collapsed">
        <div className="booking-collapsed-main">
          <div className="booking-dates-display animate-pulse">
            <div className="px-3 py-2 border border-gray-300 bg-background">
              <span className="booking-date-value text-gray-400">check-in</span>
            </div>

            <span className="booking-date-separator text-gray-300">→</span>

            <div className="px-3 py-2 border border-gray-300 bg-background">
              <span className="booking-date-value text-gray-400">check-out</span>
            </div>
          </div>
        </div>
      </div>

      <BookingPricing />
    </div>
  );
}
```

### Wire it in as the Suspense fallback

- In `apps/website/src/app/(main)/booking/[type]/page.tsx`:
  - Add `import { BookingEngineSkeleton } from "./ui/BookingEngineSkeleton";` alongside the existing `import { BookingEngine } from "./ui/BookingEngine";`.
  - Change `<Suspense fallback={null}>` to `<Suspense fallback={<BookingEngineSkeleton />}>` (the boundary wrapping `<BookingEngine roomType={roomType} />` at line 96-98).

### Validate

- Run every command in `Validation Commands` below and confirm each passes with zero regressions.

## Test Coverage

No test needed: `BookingEngineSkeleton` is a static, non-interactive presentational component — no props, no state, no hooks, no event handlers — structurally identical in kind to `BookingPricing`, which also has no dedicated test file. Per `apps/website/app_docs/testing/component_test_spec_format.md`, component tests exist to cover user interactions, accessibility behavior, and conditional rendering logic; there is none of that here to exercise, and the guide explicitly excludes testing CSS classes and async Server Components.

The `page.tsx` wiring change (swapping the `Suspense` `fallback` prop) is also not usefully covered by an automated test: `getAvailability` is `"use cache"`-tagged and normally resolves fast enough that the fallback either never paints or paints for a duration too short to assert on deterministically without artificially delaying the cache, which isn't proportionate for a loading-state chore. The change is easy to confirm visually (see Notes) and carries no logic that could regress silently.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (confirms `BookingEngineSkeleton` is actually referenced from `page.tsx`)
- `yarn turbo run test --filter=website` - Unit and component tests pass, proving no regression
- `yarn turbo run build --filter=website` - Production build succeeds

## Notes

- To eyeball the fix manually: temporarily add an artificial `await new Promise(r => setTimeout(r, 3000))` inside `BookingEngine` (or force a cache miss), load `/booking/room1` in a dev server, confirm the skeleton renders in place of blank space, then revert the temporary delay before committing.
- The skeleton intentionally keeps the old `border-gray-300` / `text-gray-400` / `animate-pulse` muted styling rather than switching to the live `.booking-date-button` class — a skeleton should look inert, not like a clickable dark-bordered control, so the visual distinction from the loaded state is deliberate, not an oversight.
- The real collapsed state (`BookingClient.tsx`) also renders a third "book" button in `.booking-dates-display` alongside the two date cells. The re-created skeleton does not add a placeholder for it, matching the issue's proposed markup verbatim aside from the required pricing-placement fix; this keeps the diff minimal and matches what was explicitly asked for.
