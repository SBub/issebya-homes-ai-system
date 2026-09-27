# Feature: Shop product image carousel (prev/next arrows on cards and detail page)

## Metadata

issue_number: `156`
adw_id: `e9bc2126`
issue_json: `{"number":156,"title":"Shop: product cards get prev/next arrows to flip through a product's images (and products get an images list)"}`

## Feature Description

A shop product today carries exactly one image (`productSchema.image`). This feature turns that into an ordered list of 1 to 8 images and adds a small client island, `ProductImageCarousel`, that shows one image at a time with thin prev/next chevrons over the photo's left and right edges at its vertical middle, plus touch swipe. The carousel is used both on each `/shop` grid card and as the main image of `/shop/[slug]`. Arrows only appear when a product has more than one image. The index is component state only; there is no autoplay, no dots, no thumbnails.

Because the card is currently one big `<a>`, and a `<button>` inside an `<a>` is invalid HTML (every arrow tap would navigate), the card is restructured into an `<article>`: the photo is wrapped in its own link, the arrows are sibling buttons of that link, and the product name in the text block carries the named link.

## User Story

As a visitor browsing the shop
I want to flip through several photos of a piece directly on its card
So that I can see it from several sides and only click through once I'm convinced

## Problem Statement

Each piece shows a single photo, so the grid cannot show a piece from more than one angle. The card's whole-card `<a>` structure also makes it impossible to place interactive controls on the card without breaking HTML validity and making every control tap a navigation.

## Solution Statement

1. Schema: extract `imageSchema`, replace `image` with `images: z.array(imageSchema).min(1).max(8)`, and add `primaryImage(product)` returning `images[0]`, used for the OG image.
2. Registry: each sample product gets 2 or 3 images reusing the existing `sample-0N.webp` files.
3. New `"use client"` `ProductImageCarousel` in `shop/ui/`: renders only the current image (`next/image`, `fill`, `object-cover`, caller-supplied `sizes`), optionally wrapped in a `<Link>` to the product; when `images.length > 1` it renders two `<button type="button">` siblings of that link with inline SVG chevrons, a visually hidden `aria-live="polite"` "Image N of M" line, touch swipe with Gallery.tsx's 50 px threshold, wrap-around navigation, and a PostHog `shop_card_image_changed` capture.
4. `ProductCard` becomes an `<article>` composed of the carousel plus the unchanged text block, with the `<Link>` moved onto the product name.
5. `/shop/[slug]` uses the same carousel (no `href`, `priority` on the first image, its existing `sizes`); `generateMetadata` uses `primaryImage`.

Colour: `globals.css` has no token literally named "accent". The shop palette defines `--color-shop-card` (#f1eac8, the cream) and `--color-shop-ground` (#6f6f6f), plus `--color-foreground`. The chevrons use **`text-shop-card`** (`--color-shop-card`), the shop's signature cream, which reads over the photos and is never a new hex literal. The implementer must state this choice in the PR/review. If the reference screenshot clearly shows a different existing token (for example `foreground`), switch the one class and say so. Do not add a token or a hex value.

## Relevant Files

Use these files to implement the feature:

- `README.md`: repo overview (read first).
- `AGENTS.md`: yarn only, conventional commits, lefthook gates.
- `apps/website/AGENTS.md`: server components by default, `"use client"` only for gallery-swipe-like state, `next/image` for all images, no Radix, which test layers gate (unit + browser gate; `e2e/` is manual/ADW only).
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md`: why the card is `aspect-[3/5]` with a `basis-[58%]` photo block and `h-full`; the `md` range `min-h` exception; `aria-labelledby` reasoning; palette rule "only `bg-shop-*` utilities, never raw hex". Matches condition "adding a field to the product schema" / "changing ProductCard".
- `apps/website/app_docs/feature-ebada8f2-shop-card-edge-to-edge.md`: the `/shop/[slug]` card layout that `shop-card-edge-to-edge.browser.test.tsx` locks down; the detail page change must keep it passing.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`: `/shop/[slug]` must stay prerendered with no hydration mismatch (the carousel's initial render must be deterministic: index 0).
- `apps/website/app_docs/component-patterns-guide.md`: component creation conventions.
- `apps/website/app_docs/nextjs-patterns-guide.md`: server vs client island split.
- `apps/website/app_docs/zod-validation-guide.md`: schema change conventions.
- `apps/website/app_docs/testing/component_test_spec_format.md`, `unit_test_spec_format.md`, `e2e_example.md`: test formats.
- `apps/website/app_docs/screenshot-mockup-guidelines.md`: the issue references a screenshot (thin chevrons, vertical middle, left/right edges, accent colour).
- `apps/website/src/lib/shop/schema.ts`: `productSchema.image` → `images`, new `imageSchema`, new `primaryImage`.
- `apps/website/src/lib/shop/products.ts`: sample registry, `image` → `images` (2 or 3 each).
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx`: restructured to `<article>` + carousel + name link.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx`: fixture shape and link assertions change; new carousel behaviour tests.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx`: main `<Image>` → carousel; OG → `primaryImage`.
- `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx`: renders `ProductPage`, which will now pull in the carousel (and `posthog-js`); add a `posthog-js` mock so the suite stays isolated.
- `apps/website/src/app/(main)/booking/[type]/ui/Gallery.tsx`: behaviour reference (touch start/end, 50 px threshold, PostHog `trigger` field). Do not modify.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx`: reference for how `posthog-js` is mocked in a browser test.
- `apps/website/src/lib/shop/__tests__/schema.unit.test.ts`: fixture shape, new `images` bounds tests and `primaryImage` test.
- `apps/website/src/lib/shop/__tests__/products.unit.test.ts`: image-exists check iterates `images`; new "2 or 3 images each" check.
- `apps/website/e2e/shop.integration.spec.ts`: card-count locator must change (two links per card now); new flip-then-navigate step.
- `apps/website/src/app/sitemap.ts`: checked; it lists no images, so no change.
- `apps/website/src/app/globals.css`: source of the colour token (`--color-shop-card`); no change.
- `docs/conditional-docs.md`: add an entry for the feature doc written in the document phase.

### New Files

- `apps/website/src/app/(main)/shop/ui/ProductImageCarousel.tsx`: the `"use client"` carousel island.

## Implementation Plan

### Phase 1: Foundation

Change the data contract: `imageSchema`, `images` array (1..8), `primaryImage`, and migrate the sample registry and the unit tests to the new shape. After this phase the only type errors left are in the two consumers (card and detail page).

### Phase 2: Core Implementation

Build `ProductImageCarousel`: state, wrap-around prev/next, swipe, analytics, live region, chevron buttons, single rendered image, optional link. Cover it through the card's browser test.

### Phase 3: Integration

Restructure `ProductCard` to an `<article>` using the carousel and a name link; swap the detail page's image for the carousel and point OG metadata at `primaryImage`; update the edge-to-edge test's mocks and the e2e spec.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs

- Read `apps/website/AGENTS.md`, `feature-6db7ada5-shop-product-grid.md`, `feature-ebada8f2-shop-card-edge-to-edge.md`, and the relevant `node_modules/next/dist/docs/` pages on `next/image` (`fill`, `sizes`, `priority`/`preload`) and `next/link`, per the workspace rule to read Next docs before coding.

### 2. Schema: `imageSchema`, `images`, `primaryImage` (`src/lib/shop/schema.ts`)

- Extract the existing image object into a module-level `const imageSchema = z.object({ src, alt, width, height })` with the same messages and the `/shop/` `startsWith` rule, keeping the existing comment about local files.
- Replace `image: ...` with `images: z.array(imageSchema).min(1, "A product needs at least one image").max(8, "A product has at most eight images")`.
- Export `type ProductImage = z.infer<typeof imageSchema>` (used by the carousel props; if knip flags it as unused elsewhere, use `Product["images"][number]` instead and don't export).
- Add and export `primaryImage(product: Pick<Product, "images">): ProductImage` returning `product.images[0]`, with a one-line doc comment: the image used wherever one image stands for the product (OG metadata). The `min(1)` guarantees it exists.
- `assertUniqueProductSlugs`, `toProduct`, `formatPrice` unchanged.

### 3. Sample registry (`src/lib/shop/products.ts`)

- Replace `image: {...}` with `images`: product at `index` gets 3 images when `index` is even, 2 when odd, drawn from `sample-0N.webp` starting at its own file and wrapping (`(index + k) % 6 + 1` for `k = 0..count-1`). So product One keeps `sample-01.webp` as its first (primary) image, unchanged.
- Alt text per image: `Placeholder image ${k + 1} of ${count} for Sample Product ${word}`, keeping 800x800.
- Update the header comment only if it mentions a single image. No new files in `public/shop/`.

### 4. Unit tests for the schema and registry

- `src/lib/shop/__tests__/schema.unit.test.ts`:
  - Fixture: `images: [{ src: "/shop/sample-01.webp", ... }]`.
  - Port the `/shop/` src test to `images: [{ ...validImage, src }]`.
  - New: rejects `images: []` (message "at least one image"); rejects 9 entries; `it.each([1, 8])` accepts that many; rejects when any one of several images has a non-`/shop/` src; rejects a product still using the old `image` key without `images`.
  - New `describe("primaryImage")`: returns the first entry of a three-image product (identity, `toBe`).
- `src/lib/shop/__tests__/products.unit.test.ts`:
  - Image-exists check iterates `allProducts.flatMap(({ images }) => images.map(({ src }) => src))`.
  - New: every sample product has 2 or 3 images.

### 5. Create `ProductImageCarousel` (`src/app/(main)/shop/ui/ProductImageCarousel.tsx`)

- `"use client"`. Imports: `next/image`, `next/link`, `posthog-js`, `useRef`, `useState`, `ProductImage` type.
- Props: `{ images: ProductImage[]; slug: string; href?: string; sizes: string; priority?: boolean }`. `href` present on the card (photo links to the product), absent on the detail page (no self-link). `sizes` passed by the caller so the card keeps `"(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"` and the page keeps `"(min-width: 768px) 50vw, 100vw"`. `priority` is only passed by the detail page and applies to the first image only (`priority={priority && index === 0}`); the card passes nothing, so default lazy loading.
- State: `const [index, setIndex] = useState(0)`; `touchStartX = useRef<number | null>(null)`; `swiped = useRef(false)`.
- `go(delta: 1 | -1, trigger: "arrow" | "swipe")`: `next = (index + delta + images.length) % images.length`; `posthog.capture("shop_card_image_changed", { product_slug: slug, index: next, trigger })`; `setIndex(next)`. Only reachable when `images.length > 1`, so single-image products never capture.
- Arrow `onClick={(e) => { e.preventDefault(); e.stopPropagation(); go(±1, "arrow"); }}` with a short comment: the arrows sit outside the link, and this guard also keeps any enclosing clickable from receiving the tap.
- Swipe: `onTouchStart` / `onTouchEnd` on the wrapper, same logic as Gallery.tsx (`diff = start - end`, threshold 50, `diff > 0` → next, `< 0` → previous) but wrapping instead of clamping, and only when `images.length > 1`. On a recognised swipe set `swiped.current = true`. The wrapper gets `onClickCapture={(e) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }}` so a synthetic click after a swipe over the photo link never navigates. Reset `swiped` on the next `touchstart`.
- Markup (the wrapper fills whatever box the caller gives it: `relative w-full h-full overflow-hidden`):
  - `<div aria-roledescription="carousel" aria-label={...}>`; give it `role="group"` so `aria-roledescription` is valid on it, and `aria-label="Product images"`.
  - The image: render only `images[index]` as `<Image key={current.src} src alt fill className="object-cover" sizes={sizes} priority=... />`. Never map over all images, so hidden images are never requested.
  - If `href`: wrap the image in `<Link href={href} tabIndex={-1} aria-hidden="true" className="absolute inset-0">`. It duplicates the name link (which carries the accessible name), so it is removed from the tab order and the accessibility tree; mouse and touch users can still click the photo. Comment this.
  - If `images.length > 1`: two `<button type="button">` siblings of the link (never inside it), `aria-label="Previous image"` / `"Next image"`, classes `group absolute top-1/2 -translate-y-1/2 left-0` / `right-0`, `flex items-center justify-center w-11 h-11` (44 px hit area), `text-shop-card`, no background/border (`bg-transparent border-0`), `cursor-pointer`, visible `focus-visible:outline` for keyboard users. Inside, an inline `<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="group-hover:[stroke-width:2]">` with a single chevron polyline (`15 5 8 12 15 19` for previous, `9 5 16 12 9 19` for next). Consider pulling the chevron into a tiny local `Chevron({ direction })` in the same file (data-only difference, per the component-patterns guide).
  - If `images.length > 1`: `<p className="sr-only" aria-live="polite">Image {index + 1} of {images.length}</p>`.
- If `images.length === 1`: no buttons, no live region, no swipe effect, no captures.

### 6. Restructure `ProductCard` (`src/app/(main)/shop/ui/ProductCard.tsx`)

- Stays a Server Component. Root becomes `<article aria-labelledby={nameId} className="flex flex-col h-full aspect-[3/5] md:max-lg:aspect-auto md:max-lg:min-h-[26rem] bg-shop-card text-foreground p-3.5">` (same geometry classes; `group` moves to the name link or stays on the article so hovering the card still underlines the name; keep the hover-underline behaviour).
- Photo block keeps `relative w-full basis-[58%] shrink-0 overflow-hidden` and contains `<ProductImageCarousel images={images} slug={slug} href={`/shop/${slug}`} sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw" />`.
- Text block unchanged (roman numeral, brand, name + price row, description) except the name `<span id={nameId}>` becomes `<Link href={`/shop/${slug}`} id={nameId} className="group-hover:underline hover:underline underline-offset-4">{name}</Link>`.
- Rewrite the doc comment: the card is an `<article>`, not a link, because the arrows are buttons and a button inside an `<a>` is invalid and navigates on every tap; the name link carries the accessible name; the photo link is a pointer-only duplicate. Keep the geometry explanation (`h-full`, 58% basis, `md` exception).

### 7. Detail page (`src/app/(main)/shop/[slug]/page.tsx`)

- `generateMetadata`: `const og = primaryImage(product)`; `images: [{ url: og.src, alt: og.alt }]`.
- Page: replace the `<Image>` with `<ProductImageCarousel images={images} slug={product.slug} sizes="(min-width: 768px) 50vw, 100vw" priority />` inside the existing `relative w-full aspect-square` box. Drop the `next/image` import if now unused.
- No request data read, so the route stays prerendered. Initial state is index 0 on server and client, so no hydration mismatch.

### 8. Browser tests (`src/app/(main)/shop/ui/ProductCard.browser.test.tsx`)

- Add `vi.mock("posthog-js", () => ({ __esModule: true, default: { capture: vi.fn() } }))` modelled on `WishlistDialog.browser.test.tsx`; import the mock to assert captures.
- Extend the `next/image` mock to pass through nothing new (it already renders `<img src alt>`); the `next/link` mock already spreads `...rest` (so `id`, `tabIndex`, `aria-hidden`, `onClick` reach the `<a>`).
- Fixtures: `ONE` (one image) and `THREE` (three images with distinct alts "Front", "Side", "Back").
- Update existing tests: "shows numeral, brand, name, price and description" (fixture shape only). Replace "the whole card is one link" with "the card is an article whose only accessible link is the product name": `getByRole("article")` exists; `getByRole("link", { name: "Linen Throw", exact: true })` has `href="/shop/linen-throw"`; `getByRole("link")` resolves to exactly one element (the photo link is `aria-hidden`); `link "III"` absent.
- New tests:
  - With one image: no `button` in the card, no "Image 1 of 1" text, `posthog.capture` not called.
  - With three: the visible `img` has alt "Front"; click `Next image` → alt "Side"; again → "Back"; again → wraps to "Front". `Previous image` from the first → "Back".
  - Live region: after one `Next image` click, `getByText("Image 2 of 3")` is present and its element has `aria-live="polite"`.
  - Only one `img` is rendered at a time (no preloading of hidden images).
  - Wrapper has `aria-roledescription="carousel"`.
  - Arrows are not inside the link: `button.closest("a")` is `null`.
  - Analytics: one `Next image` click captures `shop_card_image_changed` with `{ product_slug: "linen-throw", index: 1, trigger: "arrow" }`.
  - Swipe: dispatch `touchstart`/`touchend` on the carousel wrapper with `clientX` 200 → 100 (use `new TouchEvent` with `new Touch({ identifier: 1, target, clientX })`, chromium supports it) → alt "Side" and capture with `trigger: "swipe"`; a 30 px move changes nothing.
  - Does not navigate: render the card inside `<div onClick={outerClick}>` (standing in for any enclosing clickable, such as the old whole-card link), add a capture-phase `click` listener on `document` that records `event.defaultPrevented` after dispatch, click `Next image`, then assert `outerClick` was not called, `window.location.href` is unchanged, and the image advanced.
- **Negative check (mandatory, then revert):** temporarily delete the `preventDefault()`/`stopPropagation()` lines in the arrow handler, run `yarn turbo run test --filter=./apps/website`, confirm the "does not navigate" test fails (`outerClick` called), restore the lines, rerun green. Record in the PR description that this was tried and reverted.

### 9. Keep `shop-card-edge-to-edge.browser.test.tsx` isolated

- Add `vi.mock("posthog-js", ...)` (the detail page now renders the client carousel). No assertion changes; it must still pass (the `.bg-shop-card` block, its `article` parent, padding classes, breadcrumb above).

### 10. Playwright spec (`apps/website/e2e/shop.integration.spec.ts`)

- Update "index lists six product cards linking to /shop/…": count `page.getByRole("region", { name: "Products" }).getByRole("article")` → 6, and for each product assert `getByRole("link", { name: product.name, exact: true })` has `href="/shop/<slug>"`. (The old `a[href^="/shop/"]` locator now matches two anchors per card.)
- New test "flipping a card's images stays on /shop, then the name opens the product": `const card = page.getByRole("region", { name: "Products" }).getByRole("article").first()`; assert `card.locator("img")` has `alt` equal to `firstProduct.images[0].alt`; click `card.getByRole("button", { name: "Next image" })`; assert URL still `/shop` and the img `alt` equals `firstProduct.images[1].alt`; click `card.getByRole("link", { name: firstProduct.name, exact: true })`; assert URL `/shop/${firstProduct.slug}` and the h1.
- Existing "clicking a card opens its details page" keeps working (name link is the only link with that accessible name).
- This spec fails without the feature (no `Next image` button, no `images`).

### 11. Screenshots

- With the website dev server on this run's port (never assume 3000), capture `/shop` at 390 px and 1280 px wide after clicking the first card's `Next image` once, showing the arrows at the image's vertical middle in `--color-shop-card`. Save under the run's review artefacts / attach to the PR.

### 12. Validation

- Run every command in `Validation Commands`. Confirm the build output lists `/shop` and `/shop/[slug]` as prerendered (static / SSG).

## Testing Strategy

### Unit Tests

- `schema.unit.test.ts`: `images` bounds (0 rejected, 1 and 8 accepted, 9 rejected), per-image `/shop/` rule inside the array, old `image` key rejected, `primaryImage` returns the first entry.
- `products.unit.test.ts`: every referenced image file exists under `public/`; each sample product has 2 or 3 images.

### Test Coverage

- `src/lib/shop/__tests__/schema.unit.test.ts` (`*.unit.test.ts`): catches a registry entry with zero or more than eight images, or an off-`/shop/` image anywhere in the list, and a `primaryImage` that does not return the first image; none of this exists today.
- `src/lib/shop/__tests__/products.unit.test.ts` (`*.unit.test.ts`): catches a typo in any of the new extra image paths and sample products regressing to one image.
- `src/app/(main)/shop/ui/ProductCard.browser.test.tsx` (`*.browser.test.tsx`, gating): catches arrows rendered for a single image, prev/next not advancing or not wrapping, the live region not updating, eager rendering of all images, arrows nested inside the link, arrow clicks propagating/navigating (proved by the reverted negative check), swipe threshold regressions, and a wrong analytics payload.
- `apps/website/e2e/shop.integration.spec.ts` (`e2e/*.spec.ts`, ADW test phase): catches the real-browser journey breaking: flipping on `/shop` navigates away, or the name link no longer opens the product after a flip.
- No agent-driven `e2e/*.md` journey: the Playwright spec plus browser test cover the behaviour deterministically.

### Edge Cases

- Single-image product: no buttons, no live region, no swipe, no analytics.
- Wrap from last to first (next) and first to last (previous).
- Two-image product: next and previous both land on the other image.
- Swipe under 50 px: nothing happens; swipe over 50 px on a single-image product: nothing happens.
- Swipe over the photo link must not trigger navigation from a follow-up click.
- Detail page: no photo link (no `href`), `priority` only on the first image, hydration matches (index 0).
- Keyboard: arrows are reachable and operable with Tab/Enter/Space; the hidden photo link is skipped.
- Eight images accepted, nine rejected at build time.

## Acceptance Criteria

- `productSchema` has `images: z.array(imageSchema).min(1).max(8)` with the `/shop/` rule per image; `primaryImage` exists in `schema.ts` and is used for OG metadata; no `product.image` reference remains.
- Every sample product has 2 or 3 images using only the existing `sample-0N.webp` files.
- The card is an `<article>`; its photo is wrapped in a link to the product; arrows are `<button type="button">` siblings of that link at left/right vertical centre, labelled "Previous image"/"Next image"; the wrapper has `aria-roledescription="carousel"`; a visually hidden `aria-live="polite"` line reads "Image N of M".
- Arrows are not rendered for single-image products.
- Prev/next wrap; swipe uses a 50 px threshold; no autoplay, no dots, no thumbnails; index resets on reload.
- Arrow clicks and swipes never navigate; the negative check was performed and reverted.
- Chevrons are single-stroke inline SVG, `currentColor`, 24 px, stroke 1.5 (2 on hover), coloured with `text-shop-card` (`--color-shop-card`), no background/border, 44 px hit area; no new hex literal or token.
- Only the current image is rendered; the card image uses default (lazy) loading and the existing `sizes`; the detail page keeps its `sizes` and `priority` on the first image only.
- `/shop/[slug]` shows all of a product's images via the same carousel; OG image is `primaryImage`.
- `shop_card_image_changed { product_slug, index, trigger }` fires on each arrow/swipe change and never for single-image products.
- The roman numeral, brand, price and description render exactly as before; card geometry unchanged.
- Screenshots at 390 and 1280 px show a card mid-flip with arrows in the accent colour.
- All validation commands pass; `/shop` and `/shop/[slug]` remain prerendered.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (no remaining `product.image` reference)
- `yarn knip` - No unused files, exports or dependencies were introduced (`primaryImage` and `ProductImage` are used)
- `yarn turbo run test --filter=./apps/website` - Unit and chromium browser tests pass, including the new carousel tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and its route table shows `/shop` and `/shop/[slug]` as prerendered

## Notes

- No new dependency; no carousel library.
- Colour choice: there is no token named "accent" in `globals.css`. The plan uses `--color-shop-card` via `text-shop-card`. State this in the PR; if the owner meant a different existing token, it is a one-class change.
- The PostHog event name is `shop_card_image_changed` on both the card and the detail page (the issue defines one event). If the owner later wants to distinguish them, add a `surface: "card" | "page"` property rather than a second event.
- Carousel props extend the issue's suggested `{ images, href, slug }` with `sizes` (the card and page use different `sizes` and the issue requires keeping both) and optional `priority` (the detail page's existing LCP image). `href` is optional so the detail page doesn't self-link.
- The photo link is `aria-hidden` and `tabIndex={-1}` to avoid announcing and tabbing through two identical links per card; the name link is the accessible entry point.
- The sitemap lists no images, so it is unchanged.
- The document phase should add `app_docs/feature-e9bc2126-shop-card-image-carousel.md` and an entry in `docs/conditional-docs.md` (when changing the carousel, the product `images` list, or `ProductCard` structure), and note in `feature-6db7ada5-shop-product-grid.md`'s successors that the card is no longer a single link.
- Out of scope: lightbox/zoom, thumbnails, autoplay, captions, real photos, seller-submission photos.
