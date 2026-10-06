# Bug: shop toolbar renders differently in Safari and wastes vertical space

## Metadata

issue_number: `223`
adw_id: `3ecb6844`
issue_json: `{"number":223,"title":"fix(website): shop toolbar renders differently in Safari and wastes vertical space"}`

## Bug Description

The `/shop` toolbar (the grey `bg-shop-ground` band holding Search and Sort) looks different per browser and leaves too much empty space above the controls.

- Chrome (actual): the sort `<select>` honours our classes: 44 px tall, 1 px translucent border, uppercase spaced text, Chrome's own chevron, on one line with the search field.
- Safari (actual): the same `<select>` renders as the native macOS pill (smaller, rounded, up/down arrows). It ignores `min-h-11`, so it is shorter than the 44 px search field, and because the row aligns its children to the bottom (`items-end`) the shorter sort group sits visibly lower than the search field's centre line.
- Both browsers (actual): the band has `py-10` / `md:py-16` (40 px / 64 px) above the controls, so the toolbar floats low in a tall grey band and the grid starts late.

Expected: the sort control is the same bordered 44 px box with uppercase tracked text and our own chevron in every browser, vertically centred with the search field on one row, and the controls sit close to the top of the band. Mobile stacking (search on one line, sort on the next below ~500 px) stays as it is. Search and sort behaviour and the grid do not change.

## Problem Statement

`ShopSortControl`'s `<select>` keeps the browser's native appearance, which WebKit draws with its own size, radius and arrows regardless of our height/border classes; the toolbar row bottom-aligns its children, so any height difference shows as misalignment; and the products band's top padding is larger than the toolbar needs.

## Solution Statement

1. In `ShopSortControl.tsx`, wrap the `<select>` in a `relative` element, add `appearance-none` plus an explicit `[-webkit-appearance:none]`, `rounded-none`, a fixed `h-11` and right padding for the chevron (`pl-3 pr-8`), keep the existing border/bg/uppercase/tracking/text-xs/hover classes, and render an `aria-hidden` inline SVG chevron absolutely positioned at the right (`pointer-events-none`, `currentColor`). The control stays a native `<select>` with its `<label htmlFor>`.
2. Give the search `<input>` the same fixed `h-11` (it already has `min-h-11`) so both controls are exactly 44 px, and change `SHOP_CONTROLS_ROW_CLASS` from `items-end` to `items-center`.
3. In `page.tsx`, split the band's vertical padding so the top is small (`pt-4 md:pt-6`) and the bottom keeps its current value (`pb-10 md:pb-16`).
4. Because the sort control gets wider (chevron padding), re-measure the one-line/two-line wrap width and update the `min-[500px]` breakpoint and its comment in `ShopControlsFallback.tsx` so the fallback and live rows keep the same height at every width.

## Steps to Reproduce

1. Start the website (`yarn workspace website dev:next` with `PORT` from `.ports.env`, per the profile), open `http://localhost:$PORT/shop` at 1920x1080.
2. In Chrome: sort is a 44 px bordered box; note the ~64 px of grey above the toolbar.
3. In Safari (desktop): sort is a small native pill with up/down arrows, lower than the search field's centre.
4. In devtools on either browser, `getComputedStyle(document.querySelector('select')).appearance` is `"auto"` (in Chromium, `menulist`/`auto`), proving no reset.

## Root Cause Analysis

- Native appearance: `ShopSortControl`'s `<select>` has no `appearance` reset. Tailwind v4 preflight does not reset `appearance` on `select`, so each engine paints its own widget. Blink honours author height/border on a `menulist` select; WebKit on macOS does not (it keeps the Aqua pill and ignores `min-height`), hence the per-browser difference.
- Misalignment: `SHOP_CONTROLS_ROW_CLASS` uses `items-end`. With equal heights that is invisible (Chrome), but the shorter Safari select group is pinned to the row's bottom edge while the 44 px search field fills the line, so the sort's centre is lower.
- Empty space: `page.tsx`'s section uses `py-10 md:py-16`, symmetric padding sized for the grid's bottom, not for a toolbar at the top.
- Knock-on: `SHOP_CONTROLS_ROW_CLASS`'s `min-[500px]` breakpoint is a measured value (search form 233 px + sort 216 px + gap). Adding chevron padding widens the sort, so the breakpoint must be re-measured, or between the old and new wrap widths the fallback row (44 px min) and the wrapped live row (104 px) would differ and the grid would jump on hydration.

## Relevant Files

Use these files to fix the bug:

- `apps/website/src/app/(main)/shop/ui/ShopSortControl.tsx` - the sort `<select>`; gets the appearance reset, fixed height, chevron padding and the inline SVG chevron.
- `apps/website/src/app/(main)/shop/ui/ShopSearch.tsx` - the search `<input>`; gets `h-11` so both controls are exactly the same height. No behaviour change.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.tsx` - `SHOP_CONTROLS_ROW_CLASS` (`items-end` → `items-center`, re-measured wrap breakpoint and its comment). Shared with `ShopControls.tsx`, so the fallback and live rows stay identical.
- `apps/website/src/app/(main)/shop/ui/ShopControls.tsx` - consumer of `SHOP_CONTROLS_ROW_CLASS`; read only, no edit expected.
- `apps/website/src/app/(main)/shop/page.tsx` - the `bg-shop-ground` band; top padding reduced.
- `apps/website/src/app/(main)/shop/ui/ShopSortControl.browser.test.tsx` - extend with the appearance/chevron regression test.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.browser.test.tsx` - extend with the equal-height, same-centre assertion and a width just above the new breakpoint.
- `apps/website/e2e/shop.integration.spec.ts` - uses `page.getByLabel("Sort").selectOption(...)`; must keep passing (label association and native select unchanged).
- `apps/website/AGENTS.md` - workspace rules: browser tests are chromium-only in the gate, webkit cannot launch on macOS 14 arm64.
- `apps/website/ENGINEERING.md` ("Shop controls in the static shell") - explains the measured row min height; update the wording if the breakpoint value changes.
- `apps/website/app_docs/feature-8ad2fc3b-shop-controls-static-shell.md` - matched condition in `docs/conditional-docs.md` ("the `/shop` controls row height"); context for why the row height is pinned.
- `apps/website/app_docs/testing/component_test_spec_format.md` - format for the browser component tests.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the failing regression tests first

- In `ShopSortControl.browser.test.tsx` add a test: render `<ShopSortControl value="newest" onChange={vi.fn()} busy={false} />`, then assert `getComputedStyle(select).appearance === "none"` and that the select's `offsetHeight` is 44, and that the wrapper contains an `svg[aria-hidden="true"]` (our chevron). Also assert `getByLabelText("Sort")` still resolves to the `<select>` (`tagName === "SELECT"`).
- In `ShopControlsFallback.browser.test.tsx`, inside the existing `test.each`, add for both the fallback and live rows: the search input and the select have the same `getBoundingClientRect().height` (44) and, at 1280 px, the same vertical centre (`top + height / 2`, equal within 0.5 px).
- Run `yarn turbo run test --filter=./apps/website` and confirm the new appearance assertion fails on the unfixed code (computed `appearance` is `auto`).

### 2. Reset and restyle the sort select (`ShopSortControl.tsx`)

- Wrap the `<select>` in `<div className="relative">`; keep the outer `flex items-center gap-3` div and the `<label htmlFor={id}>`.
- `<select>` classes: `h-11 min-h-11 appearance-none [-webkit-appearance:none] rounded-none pl-3 pr-8 border border-background/60 bg-transparent uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-background`. Keep `id`, `value`, `onChange`, `aria-busy`, `disabled` and the options (with `className="text-foreground"`) unchanged.
- After the select, inside the relative wrapper, add an inline SVG chevron: `aria-hidden="true"`, `focusable="false"`, about 10x6 px, `stroke="currentColor"`, `fill="none"`, positioned `pointer-events-none absolute right-3 top-1/2 -translate-y-1/2`. No new dependency, no icon library.
- Update the component's doc comment with one sentence: native appearance is reset so WebKit and Blink draw the same box, and the chevron is ours.

### 3. Equal heights and centred row

- `ShopSearch.tsx`: add `h-11` to the input's classes (keep `min-h-11`); nothing else changes.
- `ShopControlsFallback.tsx`: in `SHOP_CONTROLS_ROW_CLASS` change `items-end` to `items-center`.

### 4. Re-measure the wrap breakpoint

- With the new sort width, measure (in the browser test or devtools at the `/shop` section's `px-4` padding) the narrowest viewport at which search and sort fit on one line. Replace `min-[500px]:min-h-11` with the new rounded-up value (e.g. `min-[530px]:min-h-11` if that is what it measures; use the measured number, not this example) and update the comment's pixel figures (search form width, sort width, wrap viewport).
- Add that width plus a few px, and that width minus a few px, to the `test.each` table in `ShopControlsFallback.browser.test.tsx` (expected min heights 44 and 104), so a future width change that breaks fallback/live parity fails.
- If the value changes, update the "about 500 px" wording in `apps/website/ENGINEERING.md` ("Shop controls in the static shell") to the new number.

### 5. Reduce the band's top spacing (`page.tsx`)

- Change the section's `py-10 md:py-16` to `pt-4 pb-10 md:pt-6 md:pb-16`. Keep `px-4 md:px-12`, `bg-shop-ground` and `min-h-screen` (it keeps the band filling the viewport while the skeleton or an empty search result shows; removing it would make the footer jump during loading, which is outside this bug).

### 6. Browser coverage for review

- No new Playwright spec: this is a styling fix with no new flow, and the existing `apps/website/e2e/shop.integration.spec.ts` already exercises the sort via `getByLabel("Sort").selectOption(...)`, which proves the select stays native and labelled. The regression gate is the browser component tests from step 1.
- Review phase: open `http://localhost:$PORT/shop` at desktop 1920x1080 and mobile 375x667, full page. Fixed state: desktop shows Search and Sort on one row, same 44 px bordered boxes, centres aligned, sort shows uppercase "NEWEST FIRST" with a thin chevron (no native arrows), and only a small grey margin (about 24 px) above the row; mobile shows search on one line and sort on the next exactly as before, with the smaller top margin (about 16 px).
- Safari parity cannot be screenshotted by the review phase (chromium only) or the gated browser tests (webkit cannot launch on macOS 14 arm64). It is guaranteed by the computed `appearance: none` the test asserts plus the explicit `-webkit-appearance: none`; a human should eyeball `/shop` in desktop Safari before merge.

### 7. Run the validation commands

- Run every command in `Validation Commands` below and fix anything that fails without weakening a test or rule.

## Test Coverage

Browser component tests (`*.browser.test.tsx`, Vitest browser mode, chromium, gated on push and in CI):

- `ShopSortControl.browser.test.tsx`: "the sort select draws no native widget": asserts computed `appearance` is `none`, height 44 px and our `aria-hidden` chevron SVG is present. Fails today (`appearance` is `auto`, no SVG); catches anyone dropping the reset, which is what makes Safari fall back to the native pill.
- `ShopControlsFallback.browser.test.tsx`: extended to assert the search input and the select are the same height and share a vertical centre in both the fallback and live rows, and to cover viewports just either side of the re-measured wrap breakpoint; catches the row misalignment returning and a hydration jump from a stale breakpoint.
  The band padding change is a styling value with no behaviour; it gets no test of its own and is checked by the review screenshots.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `yarn turbo run test --filter=./apps/website` - run before the fix (new appearance test must fail) and after (all `unit` and chromium `browser` tests pass, including the new ones).
- `yarn turbo run typecheck --filter=./apps/website` - the components still type-check.
- `yarn turbo run lint --filter=./apps/website` - lint clean.
- `yarn prettier --check .` - formatting.
- `yarn knip` - no dead exports introduced.
- `yarn turbo run build --filter=./apps/website` - production build, `/shop` still prerenders with the fallback row.
- The test phase then runs `PORT=<run port> yarn workspace website test:integration --project=chromium` automatically, covering `shop.integration.spec.ts`'s sort flows.

## Notes

- No new dependency; the chevron is an inline SVG.
- Use `h-11` (fixed) as well as `min-h-11` on both controls: equal fixed heights are what make `items-center` produce a common baseline regardless of engine defaults.
- `rounded-none` matters for WebKit, which can keep a default border radius on form controls even after the appearance reset.
- Keep the select's `text-foreground` option class: with `bg-transparent` on the select, options render on the OS's light menu and need dark text.
- `next dev` does not suspend on `useSearchParams`, so fallback/live parity is only visible in a production build (`next start`); the browser test is the reliable check.
- Commit scope: `website` (e.g. `fix(website): unify shop sort select across browsers and tighten toolbar spacing`).
