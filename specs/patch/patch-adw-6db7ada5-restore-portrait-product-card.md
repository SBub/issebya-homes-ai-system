# Patch: Restore the portrait 3:5 product card with a 58% image block

## Metadata

adw_id: `6db7ada5`
review_change_request: `Issue #1: The product card does not follow the issue's card design ("this is the design, follow it exactly"): a portrait card of about 3:5 whose image fills the top ~55-60% of the card's height. Spec step 10 specifies aspect-[3/5] on the card and an image block of relative w-full basis-[58%] shrink-0 overflow-hidden, with a single allowed fallback (min-h + h-full instead of the fixed ratio) if text clips at md widths. ProductCard.tsx took that fallback (min-h-[28rem]) and also replaced the 58% image block with aspect-square, which the spec did not allow. Measured: desktop 1920 cards are 592x691 (ratio 0.86, image 82% of height); mobile 375 cards are 343x461 (0.74, image 68%). Resolution: give the link a portrait ~3:5 ratio (restore aspect-[3/5], or keep h-full with a min-height that stays portrait at every breakpoint, e.g. aspect-[3/5] from lg up), change the image wrapper to relative w-full basis-[58%] shrink-0 overflow-hidden, re-measure at 1920/768/375 (ratio ~0.6, image ~58%, name/price row and 3-line description not clipped at 768), and update the doc comment. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-108-adw-6db7ada5-sdlc_planner-shop-product-grid.md` (step 10)
**Issue:** `apps/website/src/app/(main)/shop/ui/ProductCard.tsx` renders a near-square card: the link has `min-h-[28rem]` and no aspect ratio, and the image wrapper is `aspect-square`. So the card is 0.86 (desktop) / 0.74 (mobile) wide-to-tall and the photo is 68-82% of the card height, instead of a ~0.60 portrait card with the photo at ~58%.
**Solution:** Put `aspect-[3/5]` back on the link at every breakpoint and make the image wrapper `basis-[58%]`, exactly as spec step 10 says. The only width where 3:5 is too short for the text is the three-column `md` window (768-1023px, cards 208-293px wide). There, and only there, swap the fixed ratio for a min-height that still gives a portrait card and room for the text. From `lg` up the fixed ratio applies again.

Sizing at 768px, used to pick the numbers: the section has `md:px-12` and the grid has `gap-6`, so each card is (768 − 96 − 48) / 3 = 208px wide. At 3:5 that is 347px tall. Take off `p-3.5` (28px) and the content box is 319px, the image gets 58% of that (185px), and 134px is left for the text. The text block needs about 146px: `pt-3` 12 + numeral ~16 + brand ~15 + name/price row ~20 + three `text-xs leading-relaxed` lines ~59 + four `gap-1.5` gaps 24. So a strict 3:5 clips roughly 12px at `md`. A `24rem` (384px) min-height gives a 356px content box, a 206px image and 150px of text room. That is a ratio of 0.54 at 768px and 0.76 at 1023px: portrait all the way through the window.

Why `h-full` stays: a `basis-[58%]` percentage only resolves when the link's height is definite. The link is the only child of a stretched grid `li`, and `h-full` makes its height definite. Without it the `fill` image wrapper (whose only child is absolutely positioned) collapses to 0px in the `md` min-height window.

## Files to Modify

Use these files to implement the patch:

- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: the link's classes, the image wrapper's classes, and the doc comment. Nothing else changes: not `page.tsx`, not the grid, not the tests.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the 3:5 portrait ratio on the link, with an md-only min-height fallback

- In `ProductCard.tsx`, change the `<Link>` `className` from
  `"group flex flex-col h-full min-h-[28rem] bg-shop-card text-foreground p-3.5"`
  to
  `"group flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[24rem] bg-shop-card text-foreground p-3.5"`.
- `md:max-lg:` is a stacked Tailwind v4 range variant (`apps/website` is on `tailwindcss ^4`). It applies only for 768px ≤ width < 1024px, the three-column window where 3:5 clips. Below `md` (one and two columns, cards 292px+ wide) and from `lg` up, the card is a strict `aspect-[3/5]`.
- Keep `h-full`. It makes the `basis-[58%]` below resolve (see Solution) and keeps cards in a row equal-height through the grid's default `stretch`.

### Step 2: Replace the square image block with the 58% basis block

- Change the image wrapper `<div className="relative w-full aspect-square shrink-0 overflow-hidden">` to `<div className="relative w-full basis-[58%] shrink-0 overflow-hidden">`, which is spec step 10 verbatim. Leave the `<Image>` (its `fill`, `object-cover` and `sizes`) unchanged.
- Leave the text block (`flex flex-col gap-1.5 pt-3 text-xs`, `line-clamp-3` description) unchanged.

### Step 3: Update the doc comment

- Replace the last paragraph of the component's JSDoc (the one starting "`min-h` rather than a fixed aspect ratio…") with one that describes the new behaviour. Keep the same comment density and plain wording as the paragraph above it, and no em-dashes. Something like:
  > A portrait 3:5 card with the photo filling the top 58%, per the design. The one exception is the three-column `md` range (768-1023px), where a 3:5 card is too short for the name, price and three-line description. There it uses a portrait `min-h` instead. `h-full` makes the link's height definite, so the photo's 58% basis resolves, and the grid's default `stretch` keeps every card in a row the same height.

### Step 4: Re-measure in a real browser at 1920, 768 and 375

- Use the website dev server on this run's port (`PORT` from `.ports.env`, currently `9205`). If nothing answers there, start one with `PORT=9205 yarn workspace website dev:next` in the background. Do not use `yarn dev`, which also launches Supabase. Do not touch whatever is on 3000.
- Navigate to `http://localhost:9205/shop`. At each viewport (`browser_resize` 1920x1080, 768x1024, 375x667), run `browser_evaluate` on the first card link (`ul li a`) and on its image wrapper (the link's first child `div`). Record `getBoundingClientRect()` width/height for both. Also record, for the name/price row and the description `p`, whether `scrollHeight > clientHeight`, and whether that element's `getBoundingClientRect().bottom` is greater than the link's bottom minus its 14px padding.
- Pass criteria:
  - 1920 and 375: card width/height ≈ 0.60 (0.58-0.62). Image height ≈ 58% of the card's content box, which is about 53-56% of the full card box.
  - 768: card is portrait (ratio < 1, expected ≈ 0.54). Image ≈ 58% of the content box. The name/price row and the three-line description are fully inside the card, with no overflow and no clipping.
  - Every card in a row has the same height, and the image wrapper height is greater than 0 at all three widths.
- If 768 still clips, raise the `md:max-lg:min-h` value in 1rem steps and re-measure. Do not touch the `lg`+ or below-`md` classes. Take a `browser_take_screenshot` at each width for the review.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including `ProductCard.browser.test.tsx` (it asserts link name/href and content, not classes, so it should pass unchanged)
- `yarn knip` - No unused files, exports or dependencies
- The Step 4 browser measurements at 1920, 768 and 375 meet the pass criteria (ratio ≈ 0.60 at 1920/375 and portrait at 768, image ≈ 58% of content height, no clipped name/price or description at 768)

## Patch Scope

**Lines of code to change:** ~8 (two `className` strings, one doc-comment paragraph)
**Risk level:** low
**Testing required:** Existing lint/typecheck/unit+browser tests, plus a real-browser layout measurement of the `/shop` grid at 1920, 768 and 375 widths
