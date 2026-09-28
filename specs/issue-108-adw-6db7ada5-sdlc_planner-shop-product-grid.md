# Feature: Shop product card grid at /shop with a details page per product

## Metadata

issue_number: `108`
adw_id: `6db7ada5`
issue_json: `{"number":108,"title":"Shop: product card grid at /shop with a details page per product", ...}`

## Feature Description

Add a first, simple shop to `apps/website`: `/shop` shows a grid of editorial product cards (cream cards on a mid-grey ground, three per row on desktop), and each card links to `/shop/[slug]`, a details page that reads as the card "opened up" (breadcrumb back to `/shop`, large image, brand, name, price, full details). Products come from an explicit, zod-validated registry, exactly like the blog's post registry, seeded with 6 obviously-placeholder sample products and 6 locally generated placeholder `.webp` images. Both routes prerender into the static shell, appear in the sitemap and gain a `Shop` entry in the header nav. No cart, no checkout, no enquiry action.

## User Story

As a visitor to issebya.homes
I want to browse a grid of the house's products and open any one to see its details
So that I can see what is on offer and learn about an item before a buy/enquire flow exists

## Problem Statement

The website has booking, blog and contact, but nowhere to present products. The owner wants a shop page and a per-product page now, with the layout, routing, SEO wiring and tests in place, so that real products and photos can later be dropped in by editing one registry file and `public/shop/`.

## Solution Statement

Mirror the blog, which is already prerendered, validated and tested:

- `src/lib/shop/schema.ts` holds the zod product contract, `toProduct` (parse at module scope so a bad entry fails the build), `assertUniqueProductSlugs`, `formatPrice` (`Intl.NumberFormat`, minor units → `€12.00`) and is import-free apart from `zod`, so it runs in the vitest node pool.
- `src/lib/shop/products.ts` is the explicit registry (6 sample products, clearly labelled sample), validated and slug-checked at module scope, exporting `allProducts` and `getProductBySlug`.
- `src/lib/shop/roman.ts` exports `toRoman(n)` for 1–3999 (throws outside that range / non-integers).
- Routes: `src/app/(main)/shop/page.tsx` (grid) and `src/app/(main)/shop/[slug]/page.tsx` (`generateStaticParams`, `generateMetadata`, `notFound()`), both server components with no request reads.
- `src/app/(main)/shop/ui/ProductCard.tsx`: a server component, the whole card is one `next/link` `<Link>` whose accessible name is the product name (via `aria-labelledby` pointing at the name element).
- The blog breadcrumb moves from `src/app/(main)/blog/ui/Breadcrumb.tsx` to the shared `src/app/ui/Breadcrumb.tsx` and is generalised to take the parent link (`{ href, label }`) plus the current title; blog and shop both use it. Its browser test moves with it.
- Palette values become two CSS variables in `globals.css` exposed as Tailwind colours (`bg-shop-ground`, `bg-shop-card`), named once.
- Header gets `Shop` between `Blog` and `Contact`; sitemap gains `/shop` and every product URL from the registry.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook, `--filter` by path).
- `apps/website/AGENTS.md` - server components by default, `next/image` for all images, zod at boundaries, no Radix; which test layers gate (unit + browser gate; `e2e/` does not run in CI).
- `apps/website/ENGINEERING.md` - why pages render the way they do; test layers.
- `apps/website/app_docs/nextjs-patterns-guide.md` - adding routes / server components.
- `apps/website/app_docs/component-patterns-guide.md` - creating a component (ProductCard, shared Breadcrumb).
- `apps/website/app_docs/zod-validation-guide.md` - adding the product schema.
- `apps/website/app_docs/import-patterns-guide.md` - destructured imports.
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy (placeholder copy, page title/description; no em-dashes).
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `component_test_spec_format.md`, `e2e_example.md` - test formats.
- `apps/website/node_modules/next/dist/docs/` (or root `node_modules/next/dist/docs/`) - read the `generateStaticParams`, `notFound`, `cacheComponents` and `next/image` `sizes` docs before coding (workspace AGENTS.md rule).
- `apps/website/src/lib/blog/schema.ts` - the pattern to copy: slug regex+refine (ReDoS-safe), image object, `parse` at module scope, `assertUniqueSlugs`.
- `apps/website/src/lib/blog/posts.ts` - registry pattern and header comment explaining "imports, not a scan".
- `apps/website/src/lib/blog/__tests__/schema.unit.test.ts` - unit-test style to copy.
- `apps/website/src/app/(main)/blog/page.tsx` - index route pattern, static-shell comment.
- `apps/website/src/app/(main)/blog/[slug]/page.tsx` - detail route: `generateStaticParams`, `generateMetadata`, `notFound()`, static-shell comment block; will switch to the shared Breadcrumb.
- `apps/website/src/app/(main)/blog/ui/Breadcrumb.tsx` + `Breadcrumb.browser.test.tsx` - to be moved to `src/app/ui/` and generalised.
- `apps/website/src/app/ui/Header.tsx` - nav; add `Shop` with the existing `isActive` rule.
- `apps/website/src/app/sitemap.ts` - add `/shop` and product routes from the registry.
- `apps/website/src/app/globals.css` - add the two palette variables next to the font variables in `@theme inline`.
- `apps/website/src/lib/site.ts` - `SITE_URL` for canonical URLs and sitemap.
- `apps/website/vitest.config.ts` - browser project include `src/app/**/*.browser.test.tsx` already covers new tests; `next/link`/`next/image` already in `optimizeDeps.include`.
- `apps/website/e2e/blog-booking-flow.integration.spec.ts`, `apps/website/e2e/booking-flow.integration.spec.ts` - Playwright spec style.
- `apps/website/playwright.config.ts` - `baseURL`, single worker.
- `knip.json` - website entries already include `*.unit.test.ts`, `*.browser.test.tsx`, `e2e/**/*.ts`; no change expected, but every new export must be used.

### New Files

- `apps/website/src/lib/shop/schema.ts` - product zod schema, `Product` type, `toProduct`, `assertUniqueProductSlugs`, `formatPrice`.
- `apps/website/src/lib/shop/products.ts` - explicit registry of 6 sample products; `allProducts`, `getProductBySlug`.
- `apps/website/src/lib/shop/roman.ts` - `toRoman(n)`.
- `apps/website/src/lib/shop/__tests__/schema.unit.test.ts` - schema, uniqueness, price formatting.
- `apps/website/src/lib/shop/__tests__/roman.unit.test.ts` - `toRoman` cases.
- `apps/website/src/lib/shop/__tests__/products.unit.test.ts` - registry loads, has 6 products, all image `src` under `/shop/`, slugs unique.
- `apps/website/src/app/(main)/shop/page.tsx` - `/shop` grid.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - `/shop/[slug]` details.
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx` - the card.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx` - card rendering + link a11y.
- `apps/website/src/app/ui/Breadcrumb.tsx` - moved/generalised from blog (via `git mv`).
- `apps/website/src/app/ui/Breadcrumb.browser.test.tsx` - moved test, updated for new props, plus a shop-parent case.
- `apps/website/public/shop/sample-01.webp` … `sample-06.webp` - generated neutral placeholders, ≤ 30 KB each.
- `apps/website/e2e/shop.integration.spec.ts` - Playwright journey.

## Implementation Plan

### Phase 1: Foundation

Palette variables in `globals.css`; the shop schema, `formatPrice`, `toRoman`; generated placeholder images; the registry with 6 sample products; unit tests for all of it. Move and generalise the Breadcrumb so blog keeps working with the shared component.

### Phase 2: Core Implementation

`ProductCard` (server component) and its browser test; `/shop` grid page; `/shop/[slug]` details page with breadcrumb, metadata, static params and `notFound()`.

### Phase 3: Integration

Header nav `Shop`, sitemap entries, the Playwright spec, then the full validation run including `yarn build` to prove both shop routes are prerendered.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs first

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/nextjs-patterns-guide.md`, `component-patterns-guide.md`, `zod-validation-guide.md`, `branding-guidelines.md`.
- Read the Next 16 docs under `node_modules/next/dist/docs/` for `generateStaticParams`, `notFound`, `cacheComponents` and the `Image` `sizes` prop.

### 2. Palette variables in `globals.css`

- In the `@theme inline` block (next to `--font-sans` / `--font-hand`) add:
  - `--color-shop-ground: #6f6f6f;`
  - `--color-shop-card: #f1eac8;`
- With a one-line comment that these are the shop's two palette values, named once. Use them only as Tailwind utilities (`bg-shop-ground`, `bg-shop-card`); no other hex values in shop components. Text is `text-foreground` (near-black already defined as `--foreground`).

### 3. Shop schema: `src/lib/shop/schema.ts`

- Header comment mirroring blog `schema.ts`: this module imports only `zod`, so it runs in the node pool; `parse` not `safeParse` so a bad entry fails the build.
- `productSchema = z.object({...})`:
  - `slug`: same ReDoS-safe flat regex `/^[a-z0-9-]+$/` + refine (no leading/trailing/double hyphen) as the blog schema, message "Product slug must be lowercase kebab-case".
  - `brand`: trimmed, min 1, max ~40.
  - `name`: trimmed, min 1, max ~80.
  - `price`: `z.object({ amount: z.number().int("Price amount must be an integer number of minor units").nonnegative(), currency: z.literal("EUR") })`.
  - `description`: trimmed, min 1, `.max(240, "Product description is too long")` (card copy).
  - `details`: trimmed, min 1 (page copy).
  - `image`: `{ src: z.string().startsWith("/shop/", "Product image src must be under /shop/"), alt: min 1, width: int positive, height: int positive }`.
- `export type Product = z.infer<typeof productSchema>`.
- `export function toProduct(input: unknown): Product` → `productSchema.parse(input)`.
- `export function assertUniqueProductSlugs(products: Product[]): void` → throws `Duplicate product slug: "<slug>"` (copy of blog's).
- `export function formatPrice({ amount, currency }: Product["price"]): string` → `new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(amount / 100)` → `€12.00`. Hoist the formatter per currency is unnecessary with one currency; a module-level `const eurFormatter` is fine if simpler.
- Do not export the raw schema unless a test needs it (knip).

### 4. Roman numerals: `src/lib/shop/roman.ts`

- `export function toRoman(n: number): string` using the standard value/symbol table (`M, CM, D, CD, C, XC, L, XL, X, IX, V, IV, I`), greedy subtraction.
- Throws `RangeError` when `n` is not an integer or outside 1–3999.

### 5. Unit tests for schema and roman

- `src/lib/shop/__tests__/schema.unit.test.ts` (style of blog's schema test):
  - parses a fully valid product;
  - rejects a non-integer `price.amount` (e.g. `12.5`) with the integer message;
  - rejects `currency: "USD"`;
  - rejects `image.src` not under `/shop/` (e.g. `/terrace.webp`, and `https://example.com/a.webp`);
  - rejects a non-kebab slug (`Bad_Slug`, `-lead`, `a--b`);
  - rejects a description over 240 chars;
  - `assertUniqueProductSlugs` throws on a duplicate slug naming it, passes for unique ones;
  - `formatPrice({ amount: 1200, currency: "EUR" })` === `"€12.00"`, and `4550` → `"€45.50"`.
- `src/lib/shop/__tests__/roman.unit.test.ts`: `it.each` for 1→I, 4→IV, 9→IX, 14→XIV, 40→XL, 3999→MMMCMXCIX; throws for 0, 4000, 1.5.

### 6. Placeholder images: `public/shop/sample-01.webp` … `sample-06.webp`

- Generate 6 neutral placeholders locally, no third-party assets: e.g. 800×800 flat warm-grey/beige tones (each a slightly different neutral shade, optionally a thin inner border), encoded as webp at quality ~70. Use `cwebp`/`magick` if available, or a one-off `yarn node -e` with `sharp` (present in root `node_modules` via Next). Do NOT commit the generator script (knip would flag it); only the images.
- Verify each is ≤ 30 KB: `ls -l apps/website/public/shop`.

### 7. Registry: `src/lib/shop/products.ts`

- Header comment modelled on `blog/posts.ts`: explicit list not a scan (IO in a module both routes import would drop pages from the static shell); validated at module scope; **these six entries are sample data**, to be replaced by real products by editing this file and `public/shop/`.
- `const products: Product[] = [toProduct({...}), ...]` with 6 entries, e.g. slugs `sample-product-one` … `sample-product-six`, `brand: "Sample Brand"` (or `"Placeholder Studio"`), `name: "Sample Product One"` etc., prices as integer cents (e.g. 1200, 2400, 3650, 4800, 5500, 7200), a short neutral `description` (≤240 chars) and longer `details`, `image: { src: "/shop/sample-0N.webp", alt: "Placeholder image for Sample Product N", width: 800, height: 800 }`. No em-dashes in copy.
- `assertUniqueProductSlugs(products)`.
- `export const allProducts: Product[] = products;` and `export function getProductBySlug(slug: string): Product | undefined`.

### 8. Registry unit test: `src/lib/shop/__tests__/products.unit.test.ts`

- `allProducts` has length 6; every `image.src` starts with `/shop/`; slugs are unique; `getProductBySlug(allProducts[0].slug)` returns it; `getProductBySlug("does-not-exist")` is `undefined`.
- Optionally assert each `image.src` file exists under `public/` (via `node:fs` `existsSync` relative to the test file) so a typo in a path cannot ship; this runs in the node pool, so IO in the test is fine.

### 9. Move and generalise the Breadcrumb

- `git mv "apps/website/src/app/(main)/blog/ui/Breadcrumb.tsx" apps/website/src/app/ui/Breadcrumb.tsx` and same for `Breadcrumb.browser.test.tsx`.
- Change the signature to `Breadcrumb({ parent, title }: { parent: { href: string; label: string }; title: string })`; the first `<li>` renders `<Link href={parent.href}>{parent.label}</Link>`. Keep markup otherwise identical (`nav aria-label="Breadcrumb"`, two `<li>`, `aria-current="page"`, `aria-hidden` separator, truncate). Update the doc comment to say it is shared by blog posts and shop products and why the title is a prop.
- Update `blog/[slug]/page.tsx`: `import { Breadcrumb } from "@/app/ui/Breadcrumb"` and `<Breadcrumb parent={{ href: "/blog", label: "blog" }} title={title} />`.
- Update the moved browser test to pass `parent={{ href: "/blog", label: "blog" }}` in every case (existing assertions unchanged), and add one test that `parent={{ href: "/shop", label: "shop" }}` renders a `shop` link with `href="/shop"`.

### 10. `ProductCard`: `src/app/(main)/shop/ui/ProductCard.tsx`

- Server component (no `"use client"`). Props: `{ product: Product; position: number }` (1-based).
- Structure:
  - `<Link href={`/shop/${slug}`} aria-labelledby={nameId} className="flex flex-col h-full aspect-[3/5] bg-shop-card text-foreground p-3.5 group">` where `nameId = `product-${slug}-name``. `aria-labelledby` makes the link's accessible name exactly the product name, not the numeral, brand, description or image alt.
  - Image block: `<div className="relative w-full basis-[58%] shrink-0 overflow-hidden">` containing `<Image src alt fill className="object-cover" sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw" />`.
  - Text block `flex flex-col gap-1.5 pt-3 text-xs`:
    1. numeral: `<span className="text-xs">{toRoman(position)}</span>` (top-left);
    2. brand: `<p className="text-center uppercase tracking-[0.2em] text-[10px]">{brand}</p>`;
    3. row: `<div className="flex justify-between gap-2 font-medium text-sm"><span id={nameId}>{name}</span><span>{formatPrice(price)}</span></div>`;
    4. `<p className="text-xs leading-relaxed line-clamp-3">{description}</p>`.
  - No shadow, no rounded corners, no new fonts (inherits `font-sans`). Hover affordance: `group-hover:underline` on the name.
- If the fixed `aspect-[3/5]` clips text at narrow `md` widths, prefer `min-h` + `h-full` so rows stay equal-height through the grid's default `stretch`; equal card heights per row is the requirement.

### 11. `ProductCard` browser test: `src/app/(main)/shop/ui/ProductCard.browser.test.tsx`

- Copy the `vi.mock("next/link", ...)` stand-in from the Breadcrumb test (same reason: `next/link` touches `process`). Render with a local fixture product (not the registry, keep it component-scoped) at `position={3}`.
- Assert: numeral `III` visible; brand text visible; name visible; `€12.00` visible for `amount: 1200`; description visible; `getByRole("link", { name: <product name> })` exists (proves accessible name = name, exact match) and has `href="/shop/<slug>"`; `page.getByRole("link", { name: "III" })` is not in the document; there is exactly one link (the whole card).

### 12. `/shop` page: `src/app/(main)/shop/page.tsx`

- `export const metadata: Metadata = { title: "Shop - issebya.homes", description: "..." , alternates: { canonical: `${SITE_URL}/shop` } }`.
- Static-shell comment like the blog index (no cookies/headers/searchParams).
- Markup: `<div className="p-4 md:p-12"><h1 className="text-4xl font-hand font-bold mb-8">Shop</h1></div>` then a full-width `<section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16">` holding `<ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">` with one `<li>` per product rendering `<ProductCard product={p} position={i + 1} />`. Keep the h1 outside the grey ground (or inside, as long as colours contrast). No breadcrumb on this page.
- Empty registry fallback like blog (`No products yet.`) is optional; the registry always has entries, so skip it unless trivial.

### 13. `/shop/[slug]` page: `src/app/(main)/shop/[slug]/page.tsx`

- `generateStaticParams()` → `allProducts.map(({ slug }) => ({ slug }))`.
- `generateMetadata(props: PageProps<"/shop/[slug]">)`: unknown slug → `{ title: "Product not found - issebya.homes" }`; else title `${name} - issebya.homes`, description, canonical `${SITE_URL}/shop/${slug}`, openGraph with image `{ url: image.src, alt }`.
- Copy the blog detail's comment block on why the route has no `dynamic`, `dynamicParams`, `searchParams`, `cookies()` or `headers()`.
- Page: `const { slug } = await props.params; const product = getProductBySlug(slug); if (!product) notFound();`
- Markup: `<article className="p-4 md:p-12">`, `<Breadcrumb parent={{ href: "/shop", label: "shop" }} title={name} />`, then `<div className="grid md:grid-cols-2 gap-8 bg-shop-card text-foreground p-4 md:p-8">`: left `<div className="relative w-full aspect-square"><Image fill className="object-cover" sizes="(min-width: 768px) 50vw, 100vw" priority .../></div>`; right: brand `<p className="uppercase tracking-[0.2em] text-xs">`, `<h1 className="text-price">{name}</h1>`, price `<p className="font-medium">{formatPrice(price)}</p>`, details `<p className="text-sm leading-relaxed max-w-[65ch] whitespace-pre-line">{details}</p>`.

### 14. Header nav

- In `src/app/ui/Header.tsx` add between Blog and Contact: `<Link href="/shop" className={`pb-1 ${isActive("/shop") ? "border-b-2 border-black" : ""}`}>Shop</Link>`. No other change.

### 15. Sitemap

- In `src/app/sitemap.ts` add `{ url: `${SITE_URL}/shop`, changeFrequency: "weekly", priority: 0.6 }` to `staticRoutes`, and `productRoutes = allProducts.map(({ slug }) => ({ url: `${SITE_URL}/shop/${slug}`, changeFrequency: "monthly", priority: 0.5 }))` (no `lastModified`: products carry no date, and `new Date()` would be noise, per the file's comment). Return `[...staticRoutes, ...postRoutes, ...productRoutes]`. Update the header comment.
- A unit test of `sitemap.ts` is not feasible in the node pool (it imports `blog/posts.ts`, which imports `.mdx`, which the node pool cannot transform), so the sitemap is asserted in the e2e spec (step 16).

### 16. Playwright spec: `apps/website/e2e/shop.integration.spec.ts`

Modelled on `booking-flow.integration.spec.ts` / `blog-booking-flow.integration.spec.ts` (no DB fixtures needed: the shop reads no database).

- `"index lists six product cards linking to /shop/…"`: `goto("/shop")`; locator `page.locator('main a[href^="/shop/"]')` (or scoped to the `Products` section) has count 6.
- `"index has no breadcrumb"` (negative): `goto("/shop")`; `getByRole("navigation", { name: "Breadcrumb" })` has count 0.
- `"clicking a card opens its details page"`: click the first card link, read its `href` first; `expect(page).toHaveURL(href)`; `getByRole("heading", { level: 1 })` has the product name (read from the card link's accessible name, or from the registry via `import { allProducts } from "@/lib/shop/products"`, which is plain TS and safe in Playwright); breadcrumb nav contains a `shop` link with `href="/shop"`; clicking it returns to `/shop`.
- `"unknown slug returns 404"`: `const res = await page.goto("/shop/does-not-exist"); expect(res?.status()).toBe(404)`.
- `"header shows Shop and marks it active on a product page"`: on `/shop/<first slug>`, the header `getByRole("link", { name: "Shop", exact: true })` is visible and has class `/border-b-2/`; on `/blog` it does not.
- `"sitemap lists /shop and every product"`: `const res = await page.request.get("/sitemap.xml")`; body contains `https://issebya.com/shop</loc>` and `https://issebya.com/shop/<slug></loc>` for each of the 6 slugs (use `SITE_URL` from `@/lib/site`).

### 17. Docs

- Add a short "Shop" note to `apps/website/README.md` (routes, where products and images live, that the seed data is sample). No `AGENTS.md` change unless a gotcha surfaces. If a new reference doc is created, add it to `docs/conditional-docs.md`.

### 18. Run the Validation Commands

- Run every command below. For the build, quote the route-table lines for `/shop` and `/shop/[slug]` and confirm they are marked static (`○`) / SSG (`●`), possibly partial prerender (`◐`), and not dynamic (`ƒ`). Also confirm `/blog/[slug]` is unchanged.

## Testing Strategy

### Unit Tests

- `schema.unit.test.ts`: valid parse; non-integer price rejected; non-EUR currency rejected; image `src` outside `/shop/` rejected; bad slug rejected; description > 240 rejected; duplicate slug throws; `formatPrice` gives `€12.00` / `€45.50`.
- `roman.unit.test.ts`: 1, 4, 9, 14, 40, 3999; out-of-range and non-integer throw.
- `products.unit.test.ts`: registry loads, exactly 6 products, unique slugs, images under `/shop/` (and exist on disk), `getProductBySlug` hit/miss.

### Test Coverage

- `src/lib/shop/__tests__/schema.unit.test.ts` (unit) - catches a malformed product (float price, wrong currency, off-site image, bad/duplicate slug) reaching the build; fails without the schema.
- `src/lib/shop/__tests__/roman.unit.test.ts` (unit) - catches wrong numerals on cards (subtractive cases 4/9/40, upper bound 3999).
- `src/lib/shop/__tests__/products.unit.test.ts` (unit) - catches the registry failing to load, a wrong product count, or an image path pointing at a missing file.
- `src/app/(main)/shop/ui/ProductCard.browser.test.tsx` (browser) - catches a card missing numeral/brand/name/price/description, a wrong `href`, or a link whose accessible name is the numeral/description instead of the product name.
- `src/app/ui/Breadcrumb.browser.test.tsx` (browser, moved) - keeps the blog breadcrumb contract and adds the `shop` parent case, catching a regression from the generalisation.
- `apps/website/e2e/shop.integration.spec.ts` (Playwright) - catches the user journey breaking across pages: 6 links on `/shop`, card → details with `h1` + breadcrumb back, 404 for unknown slug, no breadcrumb on the index, header `Shop` active state, sitemap entries.
- The existing `e2e/blog-booking-flow.integration.spec.ts` covers the blog post page still rendering after the Breadcrumb move.

### Edge Cases

- Unknown slug → 404 (and `generateMetadata` does not throw first).
- Price amounts with non-zero cents (`4550` → `€45.50`) and zero (`0` → `€0.00`, allowed by `nonnegative`).
- `toRoman(0)`, `toRoman(4000)`, `toRoman(1.5)` throw.
- Long product name: truncates in the breadcrumb (existing `truncate`), wraps in the card row without pushing the price off-card (`gap-2`, price `shrink-0`).
- Description at 240 chars fits the card via `line-clamp-3`; full `details` only on the page.
- Image alt must not leak into the card link's accessible name (guarded by `aria-labelledby`).
- Header `isActive("/shop")` must not match other routes (no other route begins with `/shop`).

## Acceptance Criteria

- `/shop` renders 6 cards in a grid (1 col phones, 2 at `sm`, 3 at `md+`, ~24px gap) on a `#6F6F6F` ground; cards are cream `#F1EAC8`, portrait, no shadow, no rounded corners, image inset at top, then roman numeral, centred letter-spaced uppercase brand, name/price row, short description.
- Each card is a single link to `/shop/<slug>` whose accessible name is the product name.
- `/shop/[slug]` shows `shop › <name>` breadcrumb (shared component, `aria-label="Breadcrumb"`, `aria-current="page"`), large image left (full width on phones), brand/name (`h1`)/price/details right on cream; unknown slug is a 404.
- `/shop` has no breadcrumb.
- Products come from `src/lib/shop/products.ts`, validated with zod at module scope; 6 obviously-placeholder sample products; placeholder `.webp` images under `public/shop/`, each ≤ 30 KB, no external URLs.
- Every image uses `next/image`; the grid sets `sizes`.
- Palette values are defined once in `globals.css`.
- Header shows `Shop` between Blog and Contact and marks it active on `/shop` and `/shop/*`.
- `sitemap.xml` contains `/shop` and all six product URLs.
- `yarn build` route table shows `/shop` and `/shop/[slug]` prerendered, not `ƒ`.
- Blog breadcrumb and all blog/booking tests still pass; no booking, blog behaviour or GCA changes.
- No new dependencies, fonts, or UI libraries.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `ls -l apps/website/public/shop` - Six placeholder `.webp` files, each ≤ 30 KB
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (includes `next typegen` for `PageProps<"/shop/[slug]">`)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass (shop schema, roman, registry, ProductCard, moved Breadcrumb)
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; quote the `/shop` and `/shop/[slug]` route-table lines and confirm neither is `ƒ`
- `yarn lint && yarn typecheck && yarn test && yarn knip` - Repo-wide gate from the root, as the issue requires

## Notes

- No new libraries. `zod`, `next/image`, `next/link` and Tailwind are already present. Placeholder images are generated once with a local tool (`cwebp`/`magick`, or `sharp` already in root `node_modules`) and committed; the generator is not committed.
- Browser coverage: the Playwright spec is warranted because the journey spans two routes, a 404, the header and the sitemap. It runs as the ADW test phase's last step (`yarn workspace website test:integration`), not in CI; everything that must gate on push is in the unit and browser tests. No agent-driven `e2e/*.md` journey is needed.
- No test for the CSS palette variables or the exact grid breakpoints: these are visual styling, and asserting class names would just restate the markup. The implementation review screenshots cover the look.
- A unit test of `sitemap.ts` is not possible in the node pool because it transitively imports `.mdx` via the blog registry; the sitemap is asserted in the e2e spec instead.
- Only `apps/website` changes. Booking, blog content/behaviour, `telegram-router`, `guest-communication-agent` and `packages/pricing` are untouched; the blog only changes its Breadcrumb import and props.
- Future: WhatsApp enquiry link on the details page, `Product` JSON-LD, real products/photos (edit `products.ts` + `public/shop/`), cart/checkout. When real photos arrive, keep them `.webp` and update `width`/`height` in the registry.
