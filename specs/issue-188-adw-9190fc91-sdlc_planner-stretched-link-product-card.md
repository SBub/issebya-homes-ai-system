# Feature: Whole shop product card presses through to the product page (stretched link)

## Metadata

issue_number: `188`
adw_id: `9190fc91`
issue_json: `{"number":188,"title":"website: the whole shop product card should press through to the product page, not only the name"}`

## Feature Description

On `/shop`, each grid card (`apps/website/src/app/(main)/shop/ui/ProductCard.tsx`) is an `<article aria-labelledby>` whose only accessible link is the product name. The photo is a second, pointer-only, `aria-hidden` link inside `ProductImageCarousel`. The brand line, price, three-line description and the cream padding around them do nothing when pressed, although the card looks pressable (cream block, and the name underlines when you hover anywhere on the card). That is about 40% of a 3:5 card.

This feature makes every point of the card press through to `/shop/<slug>`. It uses the CSS "stretched link" pattern: the existing name `<Link>` gets an absolutely positioned `::after` pseudo-element that covers the `<article>`. The photo region is stacked above that overlay (`z-10`), so over the photo the carousel's own elements still get the pointer: the photo link navigates, the chevrons flip images, and swipe still lands on the carousel's `role="group"`. Everything stays a real anchor, so open in new tab, middle-click, cmd-click and `<Link>` prefetch all still work, and the card still has exactly one accessible link.

## User Story

As a visitor browsing the `/shop` grid
I want to press anywhere on a product card (name, photo, brand, price, description, padding)
So that I reach the product page without having to aim for the name, while the photo arrows and swipe still flip images

## Problem Statement

The non-photo part of the card looks pressable but is inert, so taps and clicks there do nothing. The card can't just become one big `<a>`: the carousel chevrons are `<button>`s, and a button inside an anchor is invalid HTML that navigates on every tap. The test "the arrows are not inside the link" guards that constraint.

## Solution Statement

Change `ProductCard.tsx` only, with CSS alone:

1. `<article>` gets `relative` on its own `className`, not in the shared `PRODUCT_CARD_BOX_CLASS`, so it becomes the containing block for the overlay.
2. The name `<Link>` gets `after:absolute after:inset-0 after:content-['']`. Its `::after` covers the whole article. Hit-testing a pseudo-element returns its originating element, so a press anywhere on the card lands on the name `<a>`.
3. The photo wrapper `<div>` gets `z-10` (it is already `relative`), so it paints and hit-tests above the overlay. Over the photo the target is still the carousel's pointer-only link, its chevron buttons or its `role="group"` (for touch), so `ProductImageCarousel.tsx` stays unchanged.
4. Update the doc comment to describe the stretched link and why the photo sits on top.

No `onClick`/`router.push`, no `'use client'`, no `pointer-events` tricks, no new hover styles, no new dependency. The known trade-off is accepted: description and price text can no longer be selected by dragging.

## Relevant Files

Use these files to implement the feature:

- `README.md`: repository overview.
- `AGENTS.md`: repo-wide conventions (yarn only, conventional commits, lefthook gates).
- `apps/website/AGENTS.md`: workspace rules. Server components by default. Browser tests gate on every push and must stay component-scoped. The Playwright `e2e/` suite is not in CI and runs as step 7 of the ADW test phase.
- `docs/conditional-docs.md`: index of reference docs. The entries below match this task.
- `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md`: required reading ("When changing ... the `ProductCard` `<article>`/link structure", "a card announces two links or none"). It explains why the card is an article with a pointer-only photo link.
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md`: card sizing (3:5 portrait, 58% photo basis, the `md:max-lg` exception). Context only; sizing must not change.
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: **the only production file changed.** The article, photo wrapper, name link and doc comment.
- `apps/website/src/app/(main)/shop/ui/ProductImageCarousel.tsx`: read only, **must stay unchanged**. `role="group"` with touch handlers and `onClickCapture`, the `aria-hidden` `tabIndex={-1}` `absolute inset-0` photo link, and `ArrowButton`s whose `onArrow` guard calls `preventDefault`/`stopPropagation`.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`: existing browser tests, which must stay green unchanged. The new hit-testing tests are added here, reusing its `next/link`, `next/image` and `posthog-js` mocks and its `ONE`/`THREE` fixtures.
- `apps/website/src/app/(main)/shop/ui/ProductGridSkeleton.tsx` / `ProductGridSkeleton.browser.test.tsx`: share `PRODUCT_CARD_BOX_CLASS`. The constant must stay byte-identical so the skeleton still matches the card's box.
- `apps/website/e2e/shop.integration.spec.ts`: Playwright shop suite. Assertions at lines ~47-51, 138-161 and 174-195 (`grid.getByRole("article").getByRole("link")` `toHaveText(names)`) must stay green without edits. The new e2e test goes here, next to "flipping a card's images stays on /shop, then the name opens the product" (~line 293).
- `apps/website/vitest.config.ts` / `apps/website/vitest.browser.setup.ts`: the browser project loads `src/app/globals.css` through `@tailwindcss/vite`. That's why Tailwind's `after:*`, `relative` and `z-10` classes really apply in browser tests, which makes `elementFromPoint` hit-testing meaningful there.

### New Files

None. Tests extend existing files.

## Implementation Plan

### Phase 1: Foundation

Read `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md` and `ProductImageCarousel.tsx` to confirm how the photo link and arrows work. Confirm in `apps/website/package.json` that Tailwind is `^4`: the `after:` variant needs an explicit `after:content-['']` to generate the pseudo-element.

### Phase 2: Core Implementation

Make the three class changes and the doc-comment update in `ProductCard.tsx`. Write the hit-testing browser tests, then run the negative checks (remove `after:*`, then remove `z-10`, confirm the matching assertion fails each time, and revert).

### Phase 3: Integration

Add the Playwright test to `shop.integration.spec.ts`. Confirm all existing browser and e2e assertions pass unedited, especially the one-link-per-card ones. Check at 1280 px and 390 px that `/shop` looks the same as on develop, since this change only affects hit areas.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the context

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md`, `ProductCard.tsx`, `ProductImageCarousel.tsx` and `ProductCard.browser.test.tsx`.

### 2. Make the name link a stretched link in `ProductCard.tsx`

- `<article>` className: `` `group relative ${PRODUCT_CARD_BOX_CLASS} text-foreground` ``. Do **not** edit `PRODUCT_CARD_BOX_CLASS`.
- Photo wrapper: `className="relative z-10 w-full basis-[58%] shrink-0 overflow-hidden"`.
- Name `<Link>`: `className="group-hover:underline hover:underline underline-offset-4 after:absolute after:inset-0 after:content-['']"`. Keep `href={href}` and `id={nameId}` as they are, and keep `aria-labelledby={nameId}` on the article.
- Don't add `'use client'`, `onClick`, `router.push`, `pointer-events-*` or new hover or colour classes.
- Rewrite the component doc comment. It should say that the card is still an `<article>`, not one big link, for the arrow-button reason. It should say that the name link is still the card's single accessible link and now stretches over the whole card through its `::after`. It should explain that the photo wrapper is `z-10` so it sits above that overlay, which is what keeps the pointer-only photo link, the arrows and touch swipe reachable (if the overlay covered the photo, touch events would target the name `<a>` outside the carousel and swipe would break). It should note that the text below the photo can't be selected by dragging, a deliberate trade-off, and that `pointer-events` workarounds reopen the dead area. Keep the sizing paragraph as it is.

### 3. Add hit-testing browser tests to `ProductCard.browser.test.tsx`

- Reuse the file's existing mocks and the `ONE`/`THREE` fixtures. Don't change any existing test.
- Render the card inside a fixed-width wrapper that fits in the viewport, e.g. `<div style={{ width: 300 }}><ProductCard product={THREE} /></div>`. `elementFromPoint` returns `null` for points outside the viewport, and a 3:5 card at the full default viewport width can be taller than the viewport.
- Add a small helper: `const hit = (el: Element) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); }`.
- Test "the description and price press through to the name link":
  - description: `getByText(THREE.description).element()`. `hit(...)?.closest("a")?.id` is `"product-linen-throw-name"`.
  - price: `getByText("€12.00").element()`, same assertion.
  - Optionally, the brand line (`getByText("Test Brand")`), same assertion.
- Test "the photo stays on top of the stretched link":
  - photo `<img>` (via the file's `photo(screen)` helper, `.element()`): the hit element is inside `getByRole("group", { name: "Product images" }).element()` (`group.contains(hitEl)` is true) and `hitEl.closest("a")?.id` is **not** `"product-linen-throw-name"`.
  - "Next image" button: `hit(button)` is that button or a descendant (`button.contains(hitEl)`).
- Keep "the card is an article whose only accessible link is the product name", "the arrows are not inside the link" and "an arrow click advances the image without navigating" unchanged. They must still pass.

### 4. Run the negative checks, then revert

- Temporarily remove `after:absolute after:inset-0 after:content-['']` from the name link. The description/price test must fail (the hit is the `<p>`/`<span>`). Revert.
- Temporarily remove `z-10` from the photo wrapper. The photo test must fail (the hit is the name `<a>`). Revert.
- Record in the implementation report that both were tried and reverted.

### 5. Extend the Playwright shop spec (`apps/website/e2e/shop.integration.spec.ts`)

- Add a test near "flipping a card's images stays on /shop, then the name opens the product", for example: `"pressing a card's description opens the product; its arrows still do not navigate"`.
  - `page.goto("/shop")`. Take the first card: `const card = page.getByRole("region", { name: "Products" }).getByRole("article").first();`. The first card is `newest[0]` (`firstProduct`).
  - Click the description **text** by its screen position. Use `const box = await card.getByText(firstProduct.description).boundingBox();` then `await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);`. Don't use `locator.click()` on the `<p>`: Playwright's actionability check sees that the name `<a>` (its `::after`) "intercepts pointer events" at that point and retries until timeout. That's exactly the new behaviour, but a locator click reports it as a failure. `page.mouse.click` makes a real click at that point, which is what a visitor does. Scroll first with `scrollIntoViewIfNeeded()` if needed.
  - `await expect(page).toHaveURL(`/shop/${firstProduct.slug}`)` and the product `h1` is visible.
  - `await page.goBack()` (or `page.goto("/shop")`). Then, guarded by `test.skip(!carouselProduct, ...)` as the existing carousel test is, find the carousel product's card by filtering on its name link. Click `card.getByRole("button", { name: "Next image" })`, then assert `await expect(page).toHaveURL("/shop")` and that the card's `img` `alt` is `product.images[1].alt`.
- Don't edit any existing test in the file. The `getByRole("article").getByRole("link")` `toHaveText(names)` assertions must pass as they are, which proves there's still one accessible link per card.
- This spec runs automatically as the last step of the ADW test phase (`yarn workspace website test:integration`). It is not in CI, per `apps/website/AGENTS.md`, which is why the gating proof is the browser test from step 3.

### 6. Visual no-change check

- With the website dev server on this run's `PORT` (the website honours `PORT`, don't assume 3000), take screenshots of `/shop` at 1280 px and 390 px and compare them with develop. Nothing should look different: same underline behaviour when hovering the card, no layout shift, arrows still visible over the photo.

### 7. Run the validation commands

- Run every command in `Validation Commands` and fix anything that fails.

## Testing Strategy

### Unit Tests

No `*.unit.test.ts` is needed. There's no pure logic here, and the behaviour is layout and hit-testing, which only a real DOM with real CSS can prove. That puts it at the browser-test layer.

### Test Coverage

- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`, "the description and price press through to the name link": catches the text block being inert (today `elementFromPoint` on the description returns the `<p>`, with no enclosing anchor). Fails without the `after:*` classes.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`, "the photo stays on top of the stretched link": catches the overlay swallowing the photo, which would break swipe (touch would target the name `<a>` outside the carousel) and could hide the arrows' hit area. Fails without `z-10` on the photo wrapper. Nothing today checks the stacking order.
- `apps/website/e2e/shop.integration.spec.ts`, "pressing a card's description opens the product; its arrows still do not navigate": the full journey in a real Next.js page with the real `<Link>`. Pressing card text navigates to `/shop/<slug>`, and the arrow still stays on `/shop`. Fails without the feature (the description click leaves the URL at `/shop`).
- Existing tests, unchanged, keep guarding the contracts: "the card is an article whose only accessible link is the product name", "the arrows are not inside the link", "an arrow click advances the image without navigating", "a swipe over 50px advances, a shorter one does nothing", the `ProductGridSkeleton` size-parity test, and the e2e one-link-per-card `toHaveText(names)` assertions.

### Edge Cases

- A single-image product (`ONE`) has no arrows. The photo still navigates through its own pointer-only link and the text block through the stretched link.
- The `md:max-lg` range (768-1023 px), where the card uses `min-h` instead of `aspect-[3/5]`: the overlay follows the article's box whatever its height, since it's `inset-0` on a `relative` article.
- The name wraps to two lines, or the description is clamped to three lines: the overlay is independent of the text box sizes.
- Keyboard: Tab order is unchanged. The name link is still the only focusable link, and the photo link keeps `tabIndex={-1}`. The focus ring still outlines the name text, not the pseudo-element.
- Middle-click, cmd-click or right-click "Open in new tab" on the description: the target is the real `<a href>`, so these work natively.
- Touch swipe over the photo: it targets the carousel `role="group"` (above the overlay), so the swipe handlers and `handleClickCapture` still suppress the post-swipe click.
- Text selection by drag in the description or price is no longer possible. This trade-off is accepted and must not be "fixed" with `pointer-events`.
- `/shop/[slug]` renders the carousel with no `href` and no `ProductCard`, so it is unaffected.

## Acceptance Criteria

- A press anywhere on a `/shop` card outside the photo (brand, name, price, description, padding) navigates to `/shop/<slug>` through the name `<a>`.
- Over the photo, the pointer-only photo link navigates, the "Previous image"/"Next image" buttons flip images without navigating, and touch swipe still advances images.
- Each card still exposes exactly one accessible link, named after the product. The existing browser test and the e2e `getByRole("article").getByRole("link")` `toHaveText(names)` assertions pass **without edits**.
- `aria-labelledby={nameId}`, `id={nameId}` and `href` are unchanged. `PRODUCT_CARD_BOX_CLASS` is byte-identical. `ProductImageCarousel.tsx` is unchanged. `ProductCard` is still a Server Component with no `onClick`.
- No visual change at 1280 px or 390 px compared with develop.
- The new browser tests fail when `after:*` is removed (description/price) or `z-10` is removed (photo), and pass with the change.
- The new Playwright test passes in the ADW test phase.
- lint, typecheck, knip, prettier, the website test suite and the build are all green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser (chromium) tests pass, including the new hit-testing tests and every existing `ProductCard` / `ProductGridSkeleton` test unchanged
- `yarn turbo run build --filter=./apps/website` - Production build succeeds

## Notes

- No new dependencies.
- Why the e2e test uses `page.mouse.click` rather than `locator.click()` on the description: with a stretched link, the element at the description's centre is the name `<a>` (via `::after`). Playwright's actionability check flags that as "intercepts pointer events" and retries until it times out. Using `{ force: true }` would also work but skips all actionability checks. A coordinate click is the honest simulation of a visitor's click.
- In the browser test, `elementFromPoint` on a pseudo-element returns its originating element. That's why `closest("a")?.id === "product-linen-throw-name"` identifies the stretched link exactly.
- The `ProductGridSkeleton` size-parity test depends on `PRODUCT_CARD_BOX_CLASS`. Putting `relative` on the article's own `className` keeps it untouched. (`relative` doesn't change size anyway, but the constant is a shared contract.)
- Consider adding a line to `apps/website/app_docs/feature-e9bc2126-shop-card-image-carousel.md` (or a new app_doc in the document phase) about the stretched link and the `z-10` photo layer, and a matching `docs/conditional-docs.md` trigger, e.g. "When the description/price area of a `/shop` card stops navigating, or swipe on a card photo navigates instead of flipping".
- Out of scope: `ProductImageCarousel.tsx`, `/shop/[slug]`, card styling or copy, the skeleton, making the description selectable, and the Load-more / infinite-scroll grid and shop controls (#176 / PR #182).
