# Blog booking widget clears the floated hero photo

**ADW ID:** a93e052d
**Date:** 2026-09-28
**Specification:** specs/issue-184-adw-a93e052d-sdlc_planner-blog-widget-clear-float.md

## Overview

On a blog post at `sm`+ widths, the hero photo is floated left. When the text before `<BookingWidget />` was shorter than the photo, the widget's box started beside the photo, and the photo covered its top-left corner (issue #184). The widget's `<aside>` now clears floats, so it always starts below the photo, on any post, wherever the post places it.

## What Was Built

- `clear-both` on the `BookingWidget` `<aside>`
- A component-scoped browser regression test for the float clearance
- A Playwright geometry test on the real post at 1280 px
- Unrelated to #184 but in the same branch: deflaked shop search tests (fake timers for the debounce test, search terms derived from fixtures instead of hardcoded counts)

## Technical Implementation

### Files Modified

- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`: added `clear-both` to the aside's class list, and one sentence to the doc comment saying it clears floats.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.browser.test.tsx` (new): renders a 200x200 `float-left` block in a `flow-root` container, a short paragraph, then the widget, and asserts the aside's top is at or below the float's bottom. Also asserts the aside keeps `id="book"`.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: new test, at 1280x900 the widget's top is at or below the hero `<img>`'s bottom on `/blog/welcome-to-issebya-homes`.
- `apps/website/e2e/shop.integration.spec.ts`, `apps/website/src/app/(main)/shop/ui/ShopControls.browser.test.tsx`: shop test deflaking (see Notes).

### Key Changes

- Root cause: a float only pushes line boxes aside. Block boxes keep starting at the container's left edge, so the aside's border and background were drawn under the photo while its text was pushed right. `flow-root` on the post container only makes the container contain the float; it does not make later blocks clear it.
- The fix lives in the widget, not the post or `blog/[slug]/page.tsx`. The hero float, `flow-root`, MDX content and `GuardedBookingEngine` are unchanged, and no wrapper element was added.
- `BOOKING_WIDGET_ANCHOR_ID` (`#book`) stays on the aside; the browser test guards it.
- The browser test mocks `posthog-js` (imported by `RoomSwitcher`), `@/lib/blog/return-path` (the real module pulls in the MDX post registry, which the browser bundle cannot load), and `GuardedBookingEngine` (an async Server Component reaching Stripe and Supabase).

## How to Use

1. Place `<BookingWidget />` anywhere in a post's MDX, including right after a few short paragraphs.
2. At `sm`+ widths it starts below the floated hero photo. Below `sm` the hero is `float-none`, so nothing changes there.

## Configuration

None.

## Testing

- `yarn workspace website vitest run --project browser "src/app/(main)/blog/ui/BookingWidget.browser.test.tsx"`: fails without `clear-both`, passes with it. Gated in `yarn turbo run test` and pre-push.
- `yarn workspace website test:integration`: runs the new e2e geometry test (ADW test phase only, not CI).
- Manual: open `/blog/welcome-to-issebya-homes` at 1280 px and check the widget's border box starts below the photo.

## Notes

- With clearance, the aside's `my-10` top margin may appear to collapse into the gap below the float. That is expected.
- The branch also carries a separate `fix(website): deflake shop search tests` commit: the debounce test in `ShopControls.browser.test.tsx` now uses fake `setTimeout`/`clearTimeout`, since a browser round trip between keystrokes could outlast the real 300 ms debounce on a loaded machine; `shop.integration.spec.ts` derives expected counts from fixture data and uses a broad term (`"e"`) and a no-match term (`"teapot"`) instead of hardcoded ones.
