# Chore: Shop product detail and Offer-a-piece cards go edge to edge

## Metadata

issue_number: `151`
adw_id: `ebada8f2`
issue_json: `{"number":151,"title":"Shop: product detail and Offer-a-piece cards go edge to edge, no page margin around the yellow card"}`

## Chore Description

Two shop pages wrap their yellow `bg-shop-card` content block in page padding, so the card floats inside a grey page-background frame:

- `apps/website/src/app/(main)/shop/[slug]/page.tsx`: `<article className="p-4 md:p-12">` holds the `Breadcrumb` and then `<div className="grid md:grid-cols-2 gap-8 bg-shop-card text-foreground p-4 md:p-8">`.
- `apps/website/src/app/(main)/shop/sell/page.tsx`: `<article className="p-4 md:p-12">` holds the `Breadcrumb` and then `<div className="bg-shop-card text-foreground p-4 md:p-8 flex flex-col gap-6">`.

The shop index (`apps/website/src/app/(main)/shop/page.tsx`) already has the shape the owner wants: `<section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16">` spans the full layout width with the padding **inside** the coloured block. The detail page and `/shop/sell` must match: the `bg-shop-card` block spans the full width of `<main>` (the `(main)/layout.tsx` wrapper, `<main className="flex-1">`, which applies no horizontal padding) with no page background visible to its left, right or below; only the breadcrumb stays on the page background above the card.

Contracts from the issue:

- Breadcrumb stays on the page background above the card, not inside it, wrapped in `<div className="px-4 pt-4 md:px-12 md:pt-12">`. The `Breadcrumb` component itself is not changed (it keeps its own `mb-4`, which provides the gap to the card).
- The card gets `px-4 py-8 md:px-12 md:py-12` in place of `p-4 md:p-8`, and has no outer margin. Detail page keeps `grid md:grid-cols-2 gap-8`; `/shop/sell` keeps `flex flex-col gap-6` and the intro's `max-w-[65ch]`.
- `<article>` loses `p-4 md:p-12` entirely. No negative margins, no `100vw`.
- Bottom: the index page does **not** use `min-h-[…]`, so neither do these pages. With the article's bottom padding gone, the card's bottom edge meets the footer directly.
- Mobile (390 px): same rule, card edge to edge with `px-4` inner padding.
- No change to `bg-shop-card` / `bg-shop-ground` tokens, to `Breadcrumb`, or to the product `<Image>` (`aspect-square`, `sizes="(min-width: 768px) 50vw, 100vw"`, `priority`).

Out of scope: shop index, blog, booking pages, card colours, the wishlist button, and `shop/wishlist/unsubscribe/ui/UnsubscribeMessage.tsx` (it uses the same `bg-shop-card p-4 md:p-8` pattern but the issue names only the two pages; leave it untouched).

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` - Repo-wide rules: yarn only, conventional commits, lefthook gates, `PORT` for `apps/website`.
- `apps/website/AGENTS.md` - Workspace rules; notably that `*.browser.test.tsx` is gated on push/CI while `e2e/` is not, and browser tests should stay component-scoped with mocked children.
- `apps/website/ENGINEERING.md` - Which test layers gate; why pages render statically.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Route/Server Component conventions (the two pages must stay prerendered: no request data read).
- `apps/website/app_docs/component-patterns-guide.md` - Guidance when the same JSX shape appears in more than one place (see Notes on not extracting a shared wrapper).
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - Product detail page; the article/card padding changes here.
- `apps/website/src/app/(main)/shop/sell/page.tsx` - Offer-a-piece page; same change.
- `apps/website/src/app/(main)/shop/page.tsx` - Reference for the target shape (`px-4 md:px-12` inside the coloured block, no `min-h`). Not modified.
- `apps/website/src/app/(main)/layout.tsx` - Confirms the width the card should span: `<main className="flex-1">` with no padding. Not modified.
- `apps/website/src/app/ui/Breadcrumb.tsx` - Unchanged; its `mb-4` is the breadcrumb-to-card gap.
- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx` - Precedent for rendering a page component in a browser test, including the `next/link` and `next/image` mocks to copy.
- `apps/website/src/app/(main)/booking/[type]/__tests__/metadata.unit.test.ts` - Precedent for calling a route export with `params: Promise.resolve({ ... })`.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx`, `apps/website/src/app/(main)/shop/sell/ui/SellerForm.browser.test.tsx` - Show which of those client islands' imports would need mocking; the new test mocks the islands wholesale instead.
- `apps/website/vitest.config.ts`, `apps/website/vitest.browser.setup.ts` - Browser project includes `src/app/**/*.browser.test.tsx` and imports `globals.css`, so Tailwind classes resolve to real layout in the test.
- `apps/website/e2e/shop.integration.spec.ts` - Existing shop/wishlist/seller specs that must still pass.

### New Files

- `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx` - Browser test for both pages (see Test Coverage).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the Next.js docs the workspace requires

- Per `apps/website/AGENTS.md`, skim the relevant doc under `apps/website/node_modules/next/dist/docs/` for Server Components / static rendering before editing, to confirm nothing here affects prerendering (it doesn't: markup-only change).

### 2. Product detail page: move padding inside the card

- In `apps/website/src/app/(main)/shop/[slug]/page.tsx`:
  - `<article className="p-4 md:p-12">` becomes `<article>` (no className).
  - Wrap the breadcrumb: `<div className="px-4 pt-4 md:px-12 md:pt-12"><Breadcrumb parent={{ href: "/shop", label: "shop" }} title={name} /></div>`.
  - The card div becomes `className="grid md:grid-cols-2 gap-8 bg-shop-card text-foreground px-4 py-8 md:px-12 md:py-12"`.
  - Leave the `<Image>` block, its wrapper (`relative w-full aspect-square`), `sizes`, `priority`, and the text column exactly as they are.

### 3. Offer-a-piece page: same change

- In `apps/website/src/app/(main)/shop/sell/page.tsx`:
  - `<article className="p-4 md:p-12">` becomes `<article>`.
  - Wrap the breadcrumb in `<div className="px-4 pt-4 md:px-12 md:pt-12">`.
  - The card div becomes `className="bg-shop-card text-foreground px-4 py-8 md:px-12 md:py-12 flex flex-col gap-6"`.
  - Keep the `h1`, the `max-w-[65ch]` intro paragraph and `<SellerForm />` unchanged.

### 4. Add the browser regression test

- Create `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx`:
  - Mocks: copy the `next/link` and `next/image` stand-ins from `index-pages-no-title-heading.browser.test.tsx`. Mock the client islands so their action/Supabase/PostHog/Sentry graphs never load: `vi.mock("./[slug]/ui/WishlistDialog", () => ({ WishlistDialog: () => null }))` and `vi.mock("./sell/ui/SellerForm", () => ({ SellerForm: () => null }))` (use whatever relative specifier resolves to the same module the page imports).
  - Render helpers: `ProductPage` is async, so render `await ProductPage({ params: Promise.resolve({ slug: allProducts[0].slug }) } as PageProps<"/shop/[slug]">)`; `SellPage` renders as `<SellPage />`.
  - Locate the card as the element with class `bg-shop-card` and the breadcrumb via `getByRole("navigation", { name: "Breadcrumb" })`.
  - `test.each` over both pages, asserting:
    1. The card's parent (`<article>`) has none of `p-4`, `md:p-12`, `px-4`, `md:px-12` in its `classList` (class-level contract from the issue).
    2. The card's `classList` contains `px-4`, `py-8`, `md:px-12`, `md:py-12`, and does not contain `p-4` or `md:p-8`.
    3. Layout: the card's `getBoundingClientRect()` `left`/`width` equal the render container's (`screen.container`) `left`/`width` - i.e. no page background either side (works because `globals.css` is loaded in the browser setup).
    4. The breadcrumb `nav` is not a descendant of the card (`card.contains(nav)` is false) and sits above it (`nav.bottom <= card.top`).
  - Keep the test component-scoped per `apps/website/AGENTS.md`.

### 5. Prove the test is a real gate (negative check)

- Temporarily restore `className="p-4 md:p-12"` on the `<article>` in `shop/[slug]/page.tsx`, run `yarn turbo run test --filter=./apps/website`, confirm the new test fails for `/shop/[slug]` (both the class and the bounding-box assertions). Revert, and repeat for `shop/sell/page.tsx`. Record in the PR/implementation report that this was tried and reverted.

### 6. Visual check at desktop and mobile

- Start the website dev server on this run's own port (`PORT=<run port> yarn workspace website dev`; never assume 3000, never start telegram-router or guest-communication-agent).
- Screenshot `/shop/sample-product-two` and `/shop/sell` at 1280 px and 390 px widths, plus `/shop` at both widths for comparison. Confirm: no grey page background to the card's left, right or bottom; breadcrumb on grey above the card and left-aligned with the card's content (`px-4` / `md:px-12`); index unchanged.

### 7. Run the existing e2e shop specs

- `yarn workspace website test:integration e2e/shop.integration.spec.ts` against the run's port (the ADW test phase also runs the full Playwright suite). No new e2e spec: the change is a layout-only tweak inside pages already covered by `shop.integration.spec.ts`, and the gated browser test proves the layout more cheaply.

### 8. Run the Validation Commands

- Run every command below; all must pass. In the build output confirm `/shop/[slug]` (its product paths) and `/shop/sell` are still listed as prerendered (static / SSG), not dynamic.

## Test Coverage

- `apps/website/src/app/(main)/shop/shop-card-edge-to-edge.browser.test.tsx` (`*.browser.test.tsx`, gated on push and CI): for both `/shop/[slug]` and `/shop/sell`, fails if the page padding returns to the wrapper around the `bg-shop-card` block, if the card loses its inner `px-4 py-8 md:px-12 md:py-12` padding, if the card no longer spans the full content width, or if the breadcrumb moves inside the card. Nothing currently checks the layout of either page; `shop.integration.spec.ts` only checks content and flows, and it is not in CI.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (including the `PageProps` call in the new test)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, including the new edge-to-edge test
- `yarn turbo run build --filter=./apps/website` - Production build succeeds and both routes stay prerendered
- `yarn workspace website test:integration e2e/shop.integration.spec.ts` - Existing shop, wishlist and seller e2e specs pass against this run's dev server port

## Notes

- The breadcrumb wrapper's `px-4 md:px-12` equals the card's inner `px-4 md:px-12`, so the breadcrumb text aligns with the card content's left edge, matching the index section's `md:px-12`.
- The `Breadcrumb` component's own `mb-4` stays and gives the gap between breadcrumb and card; do not add extra margin on the card (the contract is "no outer padding/margin" on it).
- No `min-h-[…]`: the index page does not use one, and the issue says to add it only if the index does.
- The two pages now share the silhouette "breadcrumb strip + edge-to-edge card", but it is two small class strings in two files that differ in layout (grid vs flex). Don't extract a shared wrapper component in this chore; that would be a refactor beyond the issue.
- `UnsubscribeMessage.tsx` has the same `bg-shop-card p-4 md:p-8` pattern and may become a follow-up issue; it is deliberately out of scope here.
- Mocking `WishlistDialog` and `SellerForm` in the new test keeps it fast and free of Sentry/PostHog/Supabase imports; those islands already have their own browser tests.
