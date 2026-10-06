# Patch: Give the shop controls row's wrap breakpoint margin for Linux Chromium fonts

## Metadata

adw_id: `3ecb6844`
review_change_request: `CI check failed on PR #224: src/app/(main)/shop/ui/ShopControlsFallback.browser.test.tsx > at 505 px the fallback row and the live row take the same box with AssertionError: expected 60 to be less than 0.5. On CI's Linux Chromium the fonts are wider than on macOS, so at 505 px the sort control wraps under the search field (its centre line is 60 px lower) while the row's min-[500px]:min-h-11 still assumes one line. The 500 px wrap breakpoint was measured with local fonts and has no margin. Patch: 1. Raise the breakpoint to min-[560px] in SHOP_CONTROLS_ROW_CLASS and anywhere else the same breakpoint is used for the shop controls. 2. Move the parity test widths to [520, 104] and [600, 44] (and the same shift in ShopSortControl.browser.test.tsx and e2e/shop.integration.spec.ts if they rely on 490 or 505). 3. Update the feature doc sentence that says the wrap breakpoint did not change: it is now 560 px with margin for font differences between macOS and Linux Chromium. No other behaviour change.`

## Issue Summary

**Original Spec:** `specs/issue-223-adw-3ecb6844-sdlc_planner-shop-toolbar-safari-spacing.md`
**Issue:** `SHOP_CONTROLS_ROW_CLASS` switches the row from the two-line box (`min-h-[104px]`) to the one-line box (`min-h-11`) at `min-[500px]`, a value measured with macOS fonts and with only ~3 px of margin (the measured fit is 497 px). CI's Linux Chromium renders the labels wider, so at 505 px the sort still wraps under the search and the browser test's centre-line assertion fails (60 px apart instead of < 0.5).
**Solution:** Raise the breakpoint to `min-[560px]` so the one-line box only applies where both engines fit search and sort on one line, and move the browser test's parity widths away from the breakpoint (`[520, 104]`, `[600, 44]`). Only the 104 px / 44 px floor of the row is a breakpoint; the actual wrap stays content-driven via `flex-wrap`, so no other control changes.

## Files to Modify

Use these files to implement the patch:

- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.tsx` - `SHOP_CONTROLS_ROW_CLASS` breakpoint and its doc comment. This is the only place the breakpoint is used: `ShopControls.tsx` imports the same constant, and `ShopSearch.tsx` / `ShopSortControl.tsx` carry no width breakpoint (verified with grep for `min-[`, `sm:` and `500`), so they need no change.
- `apps/website/src/app/(main)/shop/ui/ShopControlsFallback.browser.test.tsx` - parity widths.
- `apps/website/app_docs/feature-3ecb6844-shop-toolbar-safari-spacing.md` - breakpoint wording.

Not modified: `ShopSortControl.browser.test.tsx` and `e2e/shop.integration.spec.ts` do not use 490 or 505 (the e2e viewports are 390 and 1280, both well clear of 560).

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Raise the row breakpoint to 560 px

- In `ShopControlsFallback.tsx`, change `min-[500px]:min-h-11` to `min-[560px]:min-h-11` in `SHOP_CONTROLS_ROW_CLASS`; leave every other class untouched.
- Update the JSDoc above it: the controls share one line from about 497 px with macOS fonts but need more with Linux Chromium's wider fonts, so the one-line box applies from 560 px, which leaves margin for that difference. Keep the existing point that a shared explicit min height keeps the prerendered and hydrated rows the same size.

### Step 2: Move the parity test widths away from the breakpoint

- In `ShopControlsFallback.browser.test.tsx`, replace `[490, 104]` with `[520, 104]` and `[505, 44]` with `[600, 44]` in the `test.each` table; keep `[390, 104]` and `[1280, 44]`.
- Keep the 44 px height assertions and the centre-line assertion (`< 0.5`) for the 44 px rows unchanged.

### Step 3: Update the feature doc

- In `apps/website/app_docs/feature-3ecb6844-shop-toolbar-safari-spacing.md`, replace the Key Changes bullet "The measured `min-[500px]` wrap breakpoint did not change: ..." with: the wrap breakpoint is now `min-[560px]`, raised from the 500 px measured with macOS fonts to leave margin for the wider fonts of Linux Chromium (CI), and the parity tests at 520 px and 600 px confirm fallback and live rows still match.
- Keep the rest of the doc consistent with that: the Files bullet that mentions "widths 490 and 505" becomes "widths 520 and 600", and How to Use step 2 "Below about 500 px" becomes "Below about 560 px".

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn turbo run test --filter=./apps/website` - all `unit` and chromium `browser` tests pass, including `ShopControlsFallback.browser.test.tsx` at 390, 520, 600 and 1280 px.
- `yarn turbo run typecheck --filter=./apps/website`
- `yarn turbo run lint --filter=./apps/website`
- `yarn prettier --check .`
- `yarn knip`
- `yarn turbo run build --filter=./apps/website` - `/shop` still prerenders with the fallback row. The test phase then runs `PORT=<run port> yarn workspace website test:integration --project=chromium` against the `prepare_app` server.

## Patch Scope

**Lines of code to change:** ~10 (1 class string, ~4 comment lines, 2 test rows, 3 doc lines)
**Risk level:** low
**Testing required:** Browser component parity test at the shifted widths (must pass on CI's Linux Chromium, not only locally), plus the standard website gate and the shop integration suite.
