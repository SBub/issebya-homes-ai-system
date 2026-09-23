# Shop product grid and details page

**ADW ID:** 6db7ada5
**Date:** 2026-09-23
**Specification:** `specs/issue-108-adw-6db7ada5-sdlc_planner-shop-product-grid.md` (plus `specs/patch/patch-adw-6db7ada5-restore-portrait-product-card.md`)

## Overview

The website had booking, blog and contact pages but nowhere to present
products. `/shop` now shows a grid of editorial product cards (cream cards on a
mid-grey ground, three per row on desktop), and each card opens
`/shop/[slug]`, a details page that reads as the card opened up. Products come
from an explicit, zod-validated registry that mirrors the blog's post registry,
seeded with six placeholder products and images. There is no cart, checkout or
enquiry action yet.

## What Was Built

- A product contract (`schema.ts`): zod schema, `toProduct`, `assertUniqueProductSlugs`, `formatPrice` (integer cents to `€12.00`).
- An explicit registry of six sample products (`products.ts`) with `allProducts` and `getProductBySlug`, validated at module scope so a bad entry fails the build.
- `toRoman`, used to number each card by its grid position (I, II, III, ...).
- `/shop` grid page and `/shop/[slug]` details page, both prerendered into the static shell.
- `ProductCard`, a portrait 3:5 card where the whole card is one link named after the product.
- The blog `Breadcrumb` moved to `src/app/ui/` and generalised to take a parent link, now shared by blog posts and products.
- Two shop palette colours as Tailwind utilities (`bg-shop-ground`, `bg-shop-card`).
- `Shop` in the header nav (between Blog and Contact) and `/shop` plus every product URL in the sitemap.
- Six placeholder `.webp` images under `public/shop/`.

## Technical Implementation

### Files Modified

- `apps/website/src/lib/shop/schema.ts` (new): product schema and helpers; imports only `zod`, so it runs in the vitest node pool.
- `apps/website/src/lib/shop/products.ts` (new): the registry. Header comment marks the six entries as sample data.
- `apps/website/src/lib/shop/roman.ts` (new): `toRoman(n)` for 1 to 3999; throws `RangeError` otherwise.
- `apps/website/src/app/(main)/shop/page.tsx` (new): grid inside a `<section aria-label="Products">`.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` (new): `generateStaticParams`, `generateMetadata` (title, description, canonical, Open Graph image), `notFound()` for unknown slugs.
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx` (new): the card.
- `apps/website/src/app/ui/Breadcrumb.tsx` (moved from `(main)/blog/ui/`): now takes `parent: { href, label }` and `title`. Its browser test moved with it.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx`: uses the shared Breadcrumb with `parent={{ href: "/blog", label: "blog" }}`.
- `apps/website/src/app/ui/Header.tsx`: `Shop` link with the existing `isActive` rule.
- `apps/website/src/app/sitemap.ts`: `/shop` (weekly, 0.6) and one entry per product (monthly, 0.5, no `lastModified`).
- `apps/website/src/app/globals.css`: `--color-shop-ground: #6f6f6f` and `--color-shop-card: #f1eac8` in `@theme inline`.
- `apps/website/README.md`: route table rows and a Shop section on replacing sample data.

### Key Changes

- **Validation at the boundary.** Prices are integer minor units with `currency` fixed to `EUR`. Image `src` must start with `/shop/`, which rules out hotlinked images and keeps `next/image` working with explicit `width`/`height`. The card `description` is capped at 240 characters so it fits the card; the page `details` is uncapped and rendered with `whitespace-pre-line`. The slug uses the same ReDoS-safe regex-plus-refine as the blog.
- **Static shell.** Neither route reads cookies, headers or searchParams, and the registry does no IO (it's imports, not a directory scan). `dynamicParams` is left unset on purpose: `notFound()` handles unknown slugs without adding dynamic config under `cacheComponents`.
- **Card accessibility.** The `<Link>` has `aria-labelledby` pointing at the name, so screen readers announce just the product name rather than the numeral, brand, alt text, price and description together.
- **Card geometry.** The card is `aspect-[3/5]` with the photo in a `basis-[58%]` block. In the three-column `md` range (768 to 1023px) a strict 3:5 is too short for the text, so there it switches to `aspect-auto` with `min-h-[26rem]`. `h-full` must stay: it gives the link a definite height so the 58% basis resolves, and it keeps cards in a row the same height.
- **Shared breadcrumb.** Parent and title are props rather than read from `usePathname()`, which keeps both detail routes free of client hooks and request data.

## How to Use

1. Visit `/shop` (or click `Shop` in the header) to see the product grid.
2. Click any card to open `/shop/<slug>`; use the `shop` breadcrumb to go back.
3. To add real products, edit `apps/website/src/lib/shop/products.ts` and put the images in `apps/website/public/shop/`. Keep each entry's `width`/`height` matching its photo, and each slug unique.

## Configuration

None. No environment variables or database access. The palette colours are in `globals.css`. Use only the `bg-shop-*` utilities in shop components, never raw hex values.

## Testing

- Unit (node pool, gating): `src/lib/shop/__tests__/schema.unit.test.ts`, `roman.unit.test.ts`, `products.unit.test.ts`.
- Browser (gating): `src/app/(main)/shop/ui/ProductCard.browser.test.tsx` (content and single named link), `src/app/ui/Breadcrumb.browser.test.tsx` (now includes a shop-parent case).
- E2E (not run in CI): `e2e/shop.integration.spec.ts` covers the six cards, no breadcrumb on the index, card to details to back, 404 for an unknown slug, the header active state and the sitemap entries.
- `yarn build` in `apps/website` should list both `/shop` and `/shop/[slug]` as prerendered.

## Notes

- All six products and images are placeholders ("Sample Product One" ... "Six", 800x800 `.webp`).
- `feature-437bcd03-blog-breadcrumb-trail.md` still refers to `blog/ui/Breadcrumb.tsx`. The component now lives at `src/app/ui/Breadcrumb.tsx`.
- Card numerals come from grid position, not from the product, so reordering the registry renumbers the cards.
- The card first shipped near-square. A review patch restored the 3:5 portrait card with the 58% image block the issue asked for.
