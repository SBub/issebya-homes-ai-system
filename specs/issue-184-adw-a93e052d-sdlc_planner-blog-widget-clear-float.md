# Bug: Blog booking widget renders under the floated hero photo

## Metadata

issue_number: `184`
adw_id: `a93e052d`
issue_json: `{"number":184,"title":"website: the blog booking widget renders under the floated hero photo — its box must clear the float"}`

## Bug Description

On `/blog/welcome-to-issebya-homes` at a `sm`+ viewport (e.g. 1280 px), the "Book your stay" widget starts inside the hero photo. The widget's border and background start beside, and partly behind, the floated image. The photo covers the widget's top-left corner, while the widget's text is pushed to the right of the photo.

Expected: the widget always starts below the hero photo with its whole box visible, on every post, however much text comes before it. On mobile (< 640 px) the hero is `float-none`, so nothing should change there.

## Problem Statement

`<BookingWidget />`'s `<aside>` is a block-level box inside the post's `flow-root` container, and the hero photo is floated left in that same container. The aside does not clear the float. When the text before the widget is shorter than the photo, the aside starts while the float is still active and overlaps the photo.

## Solution Statement

Add Tailwind's `clear-both` (`clear: both`) to the `<aside>` in `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`. The class list becomes `my-10 clear-both max-w-xl bg-shop-card text-foreground border border-foreground p-4 md:p-8`. Putting the fix in the widget means any post can place `<BookingWidget />` anywhere without overlapping a float. Nothing else changes: the hero float, `flow-root`, the MDX content and `GuardedBookingEngine` stay as they are, no wrapper element is added, and `BOOKING_WIDGET_ANCHOR_ID` stays on the aside.

## Steps to Reproduce

1. `yarn workspace website dev` (it honours `PORT`, so use this worktree's port, not an assumed 3000).
2. Open `/blog/welcome-to-issebya-homes` at a 1280 px wide viewport.
3. Scroll to "Book Your Stay". The widget's border box starts next to the hero photo, and the photo covers the widget's top-left corner.
4. In DevTools, compare `document.querySelector('[data-testid="booking-widget"]').getBoundingClientRect().top` with the hero `<img>`'s `getBoundingClientRect().bottom`. The widget's top is smaller than the photo's bottom.

## Root Cause Analysis

- `apps/website/src/app/(main)/blog/[slug]/page.tsx:61-70` renders the hero as `relative float-none sm:float-left w-full sm:w-2/5 aspect-square ...` inside `<div className="flow-root">`, followed by `<Content />` (the MDX body).
- `apps/website/src/content/blog/welcome-to-issebya-homes.mdx:49` puts `<BookingWidget />` after a few short paragraphs.
- `BookingWidget.tsx:37-39`'s `<aside>` has no `clear` value.

A float only pushes line boxes aside. Block boxes still start at the container's left edge and keep their full width. So the aside's own box (background and border) is drawn under the floated image, while its inline content is pushed to the right. `flow-root` only makes the container grow to include the float; it does not make later blocks clear it. When the paragraphs before the widget are shorter than the square photo (a 2/5-width square at 1280 px is roughly 450 px tall), the aside starts before the photo ends. This is a problem in the widget, not in this one post: any post with little text before the widget hits it.

## Relevant Files

Use these files to fix the bug:

- `README.md`, `AGENTS.md`: repository conventions (yarn only, conventional commits, validation filters by path).
- `apps/website/AGENTS.md`: which test layers gate. `*.browser.test.tsx` runs in `yarn turbo run test` and on pre-push, and should stay component-scoped with mocked children. `e2e/` specs run only in the ADW test phase.
- `docs/conditional-docs.md`: indexes the docs below.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`: required reading when changing `BookingWidget`. Explains its composition and the one-widget-per-post anchor rule.
- `apps/website/app_docs/feature-4d0d9d75-blog-booking-return-link.md`: explains the `#book` anchor that must stay on the aside.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx`: **the one file changed.** The `<aside>` gets `clear-both`.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx`: the floated hero and `flow-root` container that set up the bug. Read only, do not change.
- `apps/website/src/content/blog/welcome-to-issebya-homes.mdx`: the post that shows the bug. Read only, do not change.
- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.tsx`: exports `GuardedBookingEngine({ roomType })`. The browser test mocks it. Do not change it.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx`: client tablist the widget renders. It imports `posthog-js`, which the test must mock.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx`: existing sibling browser test to copy mocking patterns from (`vi.mock("posthog-js", ...)`, `vitest-browser-react` `render`).
- `apps/website/vitest.config.ts`, `apps/website/vitest.browser.setup.ts`: the browser project includes `src/app/**/*.browser.test.tsx` and imports `src/app/globals.css` through `@tailwindcss/vite`, so Tailwind utilities (`float-left`, `flow-root`, `clear-both`) are real CSS in the test.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`: existing Playwright spec for this post and widget. It gets one geometry test.
- `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts`: scrolls to this widget. It must keep passing.

### New Files

- `apps/website/src/app/(main)/blog/ui/BookingWidget.browser.test.tsx`: component-scoped regression test for the float clearance.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the widget docs

- Read `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` and `apps/website/app_docs/feature-4d0d9d75-blog-booking-return-link.md` to confirm the anchor and composition constraints.

### 2. Add the failing browser test first

- Create `apps/website/src/app/(main)/blog/ui/BookingWidget.browser.test.tsx`:
  - `vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))` (RoomSwitcher imports it).
  - `vi.mock("../../booking/[type]/ui/GuardedBookingEngine", () => ({ GuardedBookingEngine: ({ roomType }) => <div data-testid={`engine-${roomType}`} /> }))`, typed with `BookingType`. The real engine is an async Server Component with Stripe/Supabase imports and does not belong in a browser test.
  - Import `BookingWidget` after the mocks.
  - Render the layout that `blog/[slug]/page.tsx` produces, reduced to its geometry: `<div className="flow-root" style={{ width: 800 }}>` containing `<div data-testid="float" className="float-left" style={{ width: 200, height: 200 }} />`, then one short `<p>`, then `<BookingWidget />`. Use a fixed pixel float, not `sm:` classes, so the test does not depend on the viewport width.
  - Assert `aside.getBoundingClientRect().top >= float.getBoundingClientRect().bottom`, where `aside` is `getByTestId("booking-widget")`. Also assert the aside still has `id="book"` (`BOOKING_WIDGET_ANCHOR_ID`), so the anchor cannot be moved off the aside unnoticed.
  - Add a short comment explaining why: floats push only line boxes aside, so without `clear` the aside's box starts beside the float.
- Run `yarn workspace website vitest run --project browser "src/app/(main)/blog/ui/BookingWidget.browser.test.tsx"` and confirm it **fails** against the unfixed widget.

### 3. Fix the widget

- In `BookingWidget.tsx`, change the aside's `className` to `"my-10 clear-both max-w-xl bg-shop-card text-foreground border border-foreground p-4 md:p-8"`. Change nothing else: keep the `id`, `data-testid` and children. Optionally add one sentence to the component's doc comment saying the aside clears floats so a post can place it next to a floated hero.
- Re-run the browser test and confirm it **passes**.
- Negative check: temporarily remove `clear-both`, re-run, confirm the test fails, then restore it. Say in the PR/review notes that this was tried and reverted.

### 4. Extend the Playwright spec

- In `apps/website/e2e/blog-booking-flow.integration.spec.ts`, add a test such as `"the widget starts below the floated hero photo on desktop"`:
  - `await page.setViewportSize({ width: 1280, height: 900 })`, `await page.goto(WIDGET_POST)`.
  - Get the hero with `page.locator("article img").first()` and the widget with `page.getByTestId("booking-widget")`. Take `boundingBox()` of both. With `fill`, the img has its floated wrapper's size.
  - `expect(widgetBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height)`.
  - At 1280 px with the current post, this fails before the fix and passes after it. Because it asserts the real page, it also catches a later change to the hero or MDX that brings the overlap back.
- No 390 px assertion is needed: the hero is `float-none` below `sm`, so the fix changes nothing there. Check it by screenshot (step 5).

### 5. Visual check

- Start the website dev server on this worktree's port (`yarn workspace website dev`, honouring `PORT`), and take screenshots of `/blog/welcome-to-issebya-homes` at 1280 px (widget fully below the photo) and 390 px (unchanged, photo above the text, widget full width below). Do not start `telegram-router` or `guest-communication-agent`.

### 6. Run the validation commands

- Run every command in `Validation Commands` below and confirm each is green.

## Test Coverage

- `apps/website/src/app/(main)/blog/ui/BookingWidget.browser.test.tsx` (`*.browser.test.tsx`, gated in `yarn turbo run test`, CI and pre-push): renders `<BookingWidget />` after a 200×200 `float-left` block in a `flow-root` container and asserts the aside's top is at or below the float's bottom. It catches the widget losing its float clearance. It fails without `clear-both` (checked by removing the class and restoring it) and passes with it.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`, new test (`e2e/*.spec.ts`, run by the ADW test phase, not CI): at 1280 px on the real post, the widget's top is at or below the hero image's bottom. It catches the overlap on the actual page.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `yarn workspace website vitest run --project browser "src/app/(main)/blog/ui/BookingWidget.browser.test.tsx"` - Reproduce: fails before step 3, passes after it
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including the new regression test
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and `/blog/[slug]` still prerenders

## Notes

- No new dependencies.
- The issue's constraints are contracts: do not change the hero float, `flow-root`, `page-decor-photo`, `GuardedBookingEngine` (#173) or any MDX. Do not wrap the widget in a new element. `/booking/[type]` does not use the widget and is unaffected.
- `clear-both` on the aside only moves its top edge down past active floats. Its `my-10` top margin still applies above it (as clearance, the margin may appear to collapse into the gap below the float). That is expected and out of scope, like the widget's width, spacing and copy.
- The existing `blog-booking-flow` and `booking-calendar-close-scroll` e2e specs scroll to and use this widget. They must still pass in the ADW test phase (`yarn workspace website test:integration`).
- Commit as `fix(website): clear floated hero in blog booking widget` (conventional commit, no `Co-Authored-By` trailer per repo rules).
