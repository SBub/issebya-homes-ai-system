# Booking Calendar Close Returns to the Date Row

**ADW ID:** 78e55892
**Date:** 2026-09-23
**Specification:** specs/issue-123-adw-78e55892-sdlc_planner-fix-booking-close-scroll-target.md

## Overview

Closing the expanded booking calendar used to scroll the page to the very top (`window.scrollTo({ top: 0 })`). On the mobile room page that is the gallery, and in a blog post it is the top of the article, so the guest lost the date row they were just using. Closing now scrolls to the same element expanding does: the `.booking-engine` container, with the collapsed date row at the top of the viewport. The fix lives in `BookingClient`, so `/booking/[type]` and the blog `BookingWidget` both get it.

## What Was Built

- One shared scroll helper in `BookingClient` used by both the expand effect and the close handler, so open and close can't target different places again
- Browser regression tests asserting the close scroll target (plain and inside the blog widget arrangement) and that nothing scrolls on mount
- A Playwright spec checking, in the real mobile layout, that the date row is in view after close on `/booking/room1` and in the blog widget post

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`: added `scrollEngineIntoView` (`useCallback`, `containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })`); the expand effect and `handleClose` both call it; `window.scrollTo` removed
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx`: two regression tests plus an `afterEach(vi.restoreAllMocks)` so the `Element.prototype` / `window` spies don't leak
- `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts` (new): end-to-end check on both surfaces at a 390×844 viewport

### Key Changes

- Close scroll stays in the event handler, not an effect: it only runs from `handleClose`, so `RoomSwitcher` remounts (`key={id}`) and direct visits never trigger it.
- The expand effect keeps its existing behaviour (including the auto-expand on a `?phone=` GCA link), now through the shared helper.
- No widget-specific code or new props: `BookingWidget`, `RoomSwitcher`, `BookingEngineExpanded` and `BOOKING_WIDGET_ANCHOR_ID` (`#book`) are unchanged.
- No `scroll-margin-top` was needed: the site header is in normal flow and the only sticky element (the room page's gallery column) is a sibling, not an overlay above the engine. If a sticky header is added later, add `scroll-margin-top` to `.booking-engine` in `globals.css`, not a JS offset.

## How to Use

1. Open `/booking/room1` (mobile width) or `/blog/welcome-to-issebya-homes`.
2. Scroll until the date row is mid-viewport and click `book`: the page scrolls so the engine is at the top.
3. Click `Close booking calendar`: the page stays on the engine with the date row at the top, not the gallery or article top.

## Configuration

None.

## Testing

- `yarn turbo run test --filter=./apps/website` runs the browser tests (gated in pre-push and CI). They spy on `Element.prototype.scrollIntoView` and check its `this` is the `.booking-engine` element (inside `#book` for the widget case) and that `window.scrollTo` is never called.
- `yarn workspace website test:integration` runs the Playwright spec (ADW test phase only, not CI). Smooth scrolling is asynchronous, so the spec waits until `scrollY` has been still for 30 frames before asserting; asserting straight after the click passes regardless of the scroll target.

## Notes

- The browser test hard-codes `BOOKING_WIDGET_ANCHOR_ID = "book"` instead of importing it: `@/lib/blog/return-path` pulls in the MDX post registry, which the browser test bundle cannot load. Keep the two in sync if the anchor id ever changes.
- The Playwright spec picks the live date row with `.booking-engine-collapsed:has([aria-label="Book selected dates"])`, because the Suspense skeleton renders the same classes without the labelled button.
