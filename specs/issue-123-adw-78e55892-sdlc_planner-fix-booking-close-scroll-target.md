# Bug: Closing the booking calendar scrolls to the page top instead of the date row

## Metadata

issue_number: `123`
adw_id: `78e55892`
issue_json: `{"number":123,"title":"website: closing the booking calendar scrolls to the top of the page instead of back to the date row — /booking/[type] and the blog widget"}`

## Bug Description

`BookingClient` (`apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx`) is the single booking engine. It renders on the room page `/booking/[type]` and inline in a blog post via `BookingWidget` → `RoomSwitcher` → `BookingEngine` → `BookingClient`.

- **Expand** (any of the three collapsed buttons): an effect on `isExpanded` calls `containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" })`, so the guest lands on `div.booking-engine` with the collapsed date row (`div.booking-engine-collapsed`) at the top of the viewport.
- **Close** (`Close booking calendar` button in `BookingEngineExpanded`): `handleClose` calls `window.scrollTo({ top: 0, behavior: "smooth" })`.

Actual: closing throws the guest to the top of the document. On `/booking/room1` (mobile layout) that is the gallery, above the date row they were just using; in a blog post the widget sits mid-article, so the reader is thrown to the top of the post and loses their place.

Expected: closing lands on the same element expanding lands on, the `.booking-engine` container, so the collapsed date row (dates + `book` button) is at the top of the viewport, on both surfaces.

## Problem Statement

`handleClose` scrolls to a hard-coded document position (`top: 0`) instead of the engine container that the expand path targets, so open and close are asymmetric and the close behaviour is wrong wherever the engine is not at the top of the page.

## Solution Statement

In `BookingClient`, make `handleClose` scroll `containerRef.current` into view with exactly the options the expand path uses. To keep the two paths from drifting, introduce one small local helper inside `BookingClient` (e.g. `const scrollEngineIntoView = () => containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })`, or a module-level `const ENGINE_SCROLL_OPTIONS: ScrollIntoViewOptions = { behavior: "smooth", block: "start" }` used by both calls) and use it in both the existing expand effect and `handleClose`. The close scroll is a response to a user event, so it stays in the handler, not in an effect (`no-unnecessary-effects`). The expand effect itself is unchanged in behaviour.

No widget-specific code, no new prop: `BookingWidget` gets the fix because it renders the same `BookingClient`.

Sticky header check (done during planning): `src/app/(main)/layout.tsx` renders `Header` in normal flow and nothing under `src/app/ui` is `sticky`/`fixed`; the only sticky element is the room page's gallery column (`md:sticky md:top-0`), which is a sibling column, not an overlay above the engine. So `block: "start"` leaves the date row uncovered and **no `scroll-margin-top` is needed**. If manual verification shows otherwise, add `scroll-margin-top` to `.booking-engine` in `src/app/globals.css`, not a JS offset.

## Steps to Reproduce

1. `yarn workspace website dev` (honours `PORT`; don't assume 3000).
2. Open `/booking/room1` at a mobile viewport (e.g. 390×844) so the gallery sits above the room content.
3. Scroll down until the date row (`6 Oct 2026 → 8 Oct 2026 [book]`) is mid-viewport, click `book`: the page scrolls so the engine is at the top.
4. Click `Close booking calendar`: the page scrolls to `scrollY = 0` (gallery), the date row is off-screen.
5. Repeat on `/blog/welcome-to-issebya-homes` (the post with the widget): closing lands on the post's top, not the widget.

## Root Cause Analysis

`handleClose` was written as "reset the page" (`window.scrollTo({ top: 0 })`), which only matched expectations while the engine was the first thing on the page. Two changes invalidated that assumption: the mobile room page places the gallery above the engine, and the blog widget embeds the engine mid-article. The expand path already targets the right element (`containerRef`), but the close path never reused it, so the two scroll targets diverged. Nothing tested the close scroll target, so the asymmetry went unnoticed.

## Relevant Files

Use these files to fix the bug:

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - Contains `handleClose` (the bug) and the expand `useEffect` whose `scrollIntoView` on `containerRef` is the reference behaviour. The only production file that changes.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` - Existing component-scoped browser tests, including "expanded view hides when user clicks close"; the regression tests go next to it. Already mocks `BookingEngineExpanded` with a `Close` button wired to `onClose`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` - Renders the real close button (`aria-label="Close booking calendar"`) that calls `onClose`. Read-only context; no change.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` - Wraps the engine in `<aside id={BOOKING_WIDGET_ANCHOR_ID}>`; must not change (one engine, one fix; do not rename or duplicate the `#book` id).
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` - Remounts the panel via `key`; the fix must not scroll on mount/room switch. Read-only context.
- `apps/website/src/lib/blog/return-path.ts` - Defines `BOOKING_WIDGET_ANCHOR_ID = "book"`; used by the widget-arrangement test. No change.
- `apps/website/src/app/globals.css` - `.booking-engine` rule; only touched if a sticky overlay is found (not expected, see Solution Statement).
- `apps/website/src/app/(main)/layout.tsx`, `apps/website/src/app/ui/Header.tsx` - Confirmed non-sticky header.
- `apps/website/e2e/booking-flow.integration.spec.ts`, `apps/website/e2e/blog-booking-flow.integration.spec.ts` - Patterns for the Playwright spec (`baseURL` preconfigured, `WIDGET_POST` path).
- `apps/website/AGENTS.md` - "Which test layers gate": browser tests gate on push/CI, `e2e/` does not.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` - Conditional doc: changing anything that renders `BookingEngine` outside `/booking/[type]`.
- `apps/website/app_docs/feature-e259222e-room-switcher-calendar-reset.md` - Conditional doc: `RoomSwitcher` remount semantics and how to browser-test the real `BookingClient` without `submitBooking`.
- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md` - Conditional doc: `BookingClient` collapsed-state DOM/classes.
- `apps/website/app_docs/testing/component_test_spec_format.md` - Conditional doc: writing component tests.
- `apps/website/app_docs/testing/e2e_example.md` - Conditional doc: adding a Playwright spec.

### New Files

- `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts` - Playwright spec proving, in a real layout, that closing the calendar leaves the date row in view on `/booking/room1` and in the blog widget.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conditional docs

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md`, `apps/website/app_docs/feature-e259222e-room-switcher-calendar-reset.md`, `apps/website/app_docs/testing/component_test_spec_format.md` and `apps/website/app_docs/testing/e2e_example.md`.

### 2. Write the failing browser regression tests first

In `BookingClient.browser.test.tsx`:

- Add `vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))` if needed to keep captures inert (matches `RoomSwitcher.browser.test.tsx`).
- Add a test right after "expanded view hides when user clicks close", e.g. `"closing the calendar scrolls back to the engine, not the page top"`:
  - `const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});`
  - `const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});`
  - Render `<BookingClient {...defaultProps} />`; assert `scrollIntoView` **not** called on mount (direct visitor, no `?phone=`), guarding the "never on mount" contract.
  - Click `Book selected dates`, wait for `mock-expanded`, then `scrollIntoView.mockClear()` so only the close call is observed.
  - Click `Close`, wait for `mock-expanded` to disappear.
  - Assert `scrollIntoView` was called once with `{ behavior: "smooth", block: "start" }` and that its `mock.contexts[0]` (the `this`) is `container.querySelector(".booking-engine")`.
  - Assert `scrollTo` was **not** called.
  - Restore spies (`vi.restoreAllMocks()` in the test or an `afterEach`), since `vi.clearAllMocks()` in the existing `beforeEach` does not restore prototypes.
- Add a second test proving the widget path, e.g. `"inside the blog widget arrangement, closing lands on the engine"`:
  - Render `<aside id={BOOKING_WIDGET_ANCHOR_ID}><div style={{ height: 2000 }}>article above</div><BookingClient {...defaultProps} /></aside>` (import `BOOKING_WIDGET_ANCHOR_ID` from `@/lib/blog/return-path`). Keep the real `BookingClient` and the existing `BookingEngineExpanded` mock; do not import `BookingWidget` itself (Server Component with `BookingEngine` data fetching).
  - Same spies and steps; assert the `this` of the close `scrollIntoView` call is the `.booking-engine` inside `#book` (not the aside, not the document), `block: "start"`, and `window.scrollTo` not called.
- Run `yarn turbo run test --filter=./apps/website` and confirm both new tests **fail** against the unfixed code on the `scrollTo`/`scrollIntoView` assertions. Record the failure output.

### 3. Fix `handleClose` in `BookingClient.tsx`

- Introduce one shared scroll call used by both paths, e.g. inside the component:
  ```ts
  const scrollEngineIntoView = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  ```
  (or a module-level `ScrollIntoViewOptions` constant used by both call sites; pick one, keep it minimal).
- Expand effect: replace the inline `scrollIntoView` with the helper, keeping the `if (isExpanded)` guard and behaviour identical (add the helper to the deps array if it is a `useCallback`).
- `handleClose`: `setIsExpanded(false); scrollEngineIntoView();` and delete `window.scrollTo({ top: 0, behavior: "smooth" })`. No `useEffect`, no new props, no posthog capture on close.
- Update the nearby comment so it says close returns to the date row, same target as expand.
- Leave `BookingWidget.tsx`, `RoomSwitcher.tsx`, `BookingEngineExpanded.tsx` and `return-path.ts` untouched.

### 4. Negative check of the regression test

- Re-run `yarn turbo run test --filter=./apps/website`: both new tests pass.
- Temporarily restore the old `handleClose` body (`window.scrollTo({ top: 0, behavior: "smooth" })`), re-run, confirm the first new test fails on the `window.scrollTo` not-called assertion, then revert the probe. Verify with `git diff` that the probe is not in the diff. Note the commands and results in the PR description.

### 5. Add the Playwright spec

Create `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts`, modelled on `blog-booking-flow.integration.spec.ts` (no DB fixtures needed: it only opens and closes the calendar):

- `test.use({ viewport: { width: 390, height: 844 } })` so the gallery sits above the engine on the room page.
- Test "closing the calendar on /booking/room1 returns to the date row":
  - `page.goto("/booking/room1")`; locate the engine `page.locator(".booking-engine")` and its date row `.booking-engine-collapsed`.
  - Scroll the date row to mid-viewport (`scrollIntoViewIfNeeded`), click `Book selected dates`, wait for the `Close booking calendar` button.
  - Click `Close booking calendar`.
  - `await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)` (smooth scroll settles over time; the old code ends at 0) and `await expect(dateRow).toBeInViewport()`.
- Test "closing the calendar in a blog post returns to the widget, not the post top": same steps on `/blog/welcome-to-issebya-homes`, scoping locators to `page.getByTestId("booking-widget")`; additionally assert the post's `h1` is **not** in the viewport after close.
- This spec should fail on the unfixed code (`scrollY` polls to 0) and pass after. It runs in the ADW test phase via `yarn workspace website test:integration`; it is not in CI, which is why the gating regression lives in the browser tests.

### 6. Manual preview check

- On the PR preview (or local dev on this worktree's `PORT`), both `/booking/room1` and the widget post: scroll so the engine is mid-viewport, open, close; the date row is at the top of the viewport. Record browser and viewport in the PR.

### 7. Run the Validation Commands

- Run every command in `Validation Commands` and confirm all pass.

## Test Coverage

- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` (`*.browser.test.tsx`, gated in CI and pre-push): "closing the calendar scrolls back to the engine, not the page top" catches `handleClose` scrolling to `top: 0` (or any target other than `.booking-engine` with `block: "start"`), and asserts no scroll on mount. Fails today on the `window.scrollTo` not-called assertion.
- Same file: "inside the blog widget arrangement, closing lands on the engine" catches a regression where the widget path diverges (e.g. a widget-only scroll handler or targeting the `#book` aside).
- `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts` (Playwright, ADW test phase only): proves in a real layout that the date row stays in view after close on both surfaces.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- Before the fix: `yarn turbo run test --filter=./apps/website` - the two new browser tests fail (reproduces the bug); after the fix they pass
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the bug is fixed with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds

## Notes

- No new dependencies.
- Scope is `apps/website` only; no change to `telegram-router`, `guest-communication-agent`, `packages/pricing` or `supabase`.
- The expand effect still fires on mount when a GCA link auto-expands (`?phone=`); that is existing, out-of-scope expand behaviour. The close scroll only runs from `handleClose`, so `RoomSwitcher` remounts (`key={id}`) never trigger it.
- `BOOKING_WIDGET_ANCHOR_ID` (`#book`) and the Stripe cancel/return anchors are untouched.
- No `posthog.capture` on close exists today; none is added.
- Jitter note for the Playwright spec: smooth scrolling is asynchronous, so assert with `expect.poll` / `toBeInViewport` rather than an immediate `scrollY` read.
