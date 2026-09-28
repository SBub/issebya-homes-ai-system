# Chore: Drop the page-title headings on /blog, /contact and /shop

## Metadata

issue_number: `133`
adw_id: `a68d5b41`
issue_json: `{"number":133,"title":"website: drop the page-title headings on /blog, /contact and /shop — the active nav tab already says where you are"}`

## Chore Description

Three index pages on `apps/website` open with a large page-title `<h1>` that repeats the nav item the reader just clicked:

- `src/app/(main)/blog/page.tsx:18` — `<h1 className="text-4xl font-hand font-bold mb-8">Blog</h1>`
- `src/app/(main)/shop/page.tsx:18` — `<h1 className="text-4xl font-hand font-bold">Shop</h1>`, alone inside its own `<div className="p-4 md:p-12">` wrapper above the `bg-shop-ground` products section
- `src/app/(main)/contact/page.tsx:8` — `<h1 className="text-4xl text-header mb-6">Contact</h1>`

`src/app/ui/Header.tsx` already marks the current section (`isActive(path)` gives the nav link `border-b-2 border-black`), and its site name is itself an `<h1>` (`Header.tsx:20`), rendered on every `(main)` page by `src/app/(main)/layout.tsx`. Each of these index pages therefore has two `h1`s, and the second only restates the underlined tab. The owner wants them removed.

Contracts (from the issue, not preferences):

- Only the three index pages change. Blog post (`blog/[slug]/page.tsx:56`) and product (`shop/[slug]/page.tsx:67`) headings, booking pages, the `Booking Confirmed` heading and the header's own `<h1>` are untouched.
- `metadata.title` on blog and shop stays. Contact has no `metadata` today and none is added.
- The header's site-name `h1` becomes the page's only `h1`. Do not demote/remove it, and do not promote the blog list's `h2` post titles or product cards to `h1`.
- Spacing: on `/shop` remove the wrapper `div` too, so the `bg-shop-ground` section sits directly under the header (the header's `md:border-b md:border-gray-300` still separates them at `md+`). On `/blog` and `/contact` keep the outer `p-4 md:p-12` and remove only the heading (its `mb-*` goes with it).
- No new components, no CSS changes to `text-header` / `font-hand` (other pages use them).
- No visually hidden `h1`, no breadcrumbs, no header redesign.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` — repo conventions (yarn only, conventional commits, lefthook gates).
- `apps/website/AGENTS.md` — workspace rules: server components by default, `<Image>`, Next.js docs first; and which test layers gate (browser tests run on push/CI, `e2e/` is manual + ADW test phase only).
- `apps/website/ENGINEERING.md` — read the section on why pages render the way they do (static shell) before touching route files.
- `apps/website/app_docs/nextjs-patterns-guide.md` — route / Server Component conventions (the three pages must stay static, server components).
- `apps/website/src/app/(main)/blog/page.tsx` — delete the `Blog` `<h1>` (line 18) and the blank line after it; keep `<div className="p-4 md:p-12">`.
- `apps/website/src/app/(main)/shop/page.tsx` — delete the `<div className="p-4 md:p-12">` wrapper holding the `Shop` `<h1>` (lines 17-19) and the blank line after it; the `<section aria-label="Products" …>` becomes the first child of the outer `<div>`.
- `apps/website/src/app/(main)/contact/page.tsx` — delete the `Contact` `<h1>` (line 8) and the blank line after it; keep `<div className="p-4 md:p-12">`.
- `apps/website/src/app/ui/Header.tsx` — read only: confirms the active-tab underline and the site-name `h1` that remains. Not modified.
- `apps/website/src/app/(main)/layout.tsx` — read only: shows Header is rendered by the layout, not by the page components, so a page-level test does not see it.
- `apps/website/src/lib/blog/posts.ts` — read only: imports an `.mdx` file, which Vite browser mode cannot transform, so the new test must `vi.mock` this module.
- `apps/website/src/lib/blog/schema.ts` — read only: the `BlogPost` type for the mocked post fixture.
- `apps/website/src/lib/shop/products.ts` — read only: plain TS registry, safe to import in browser mode.
- `apps/website/src/app/(main)/shop/ui/ProductCard.browser.test.tsx` — the model for the new test's `next/link` / `next/image` mocks and `vitest-browser-react` usage.
- `apps/website/vitest.config.ts` — browser project includes `src/app/**/*.browser.test.tsx`; `optimizeDeps.include` already lists `next/image`, `next/link`, `posthog-js`, `date-fns`, `zod`, so no config change is needed.
- `apps/website/e2e/shop.integration.spec.ts`, `apps/website/e2e/blog-booking-flow.integration.spec.ts`, `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts` — read only: assert on the detail-page headings; they must keep passing.

### New Files

- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx` — one browser test covering all three index page components.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs the workspace requires

- Read `apps/website/AGENTS.md`, the relevant part of `apps/website/ENGINEERING.md`, and `apps/website/app_docs/nextjs-patterns-guide.md`.
- Per `apps/website/AGENTS.md`, skim the Next.js docs in `apps/website/node_modules/next/dist/docs/` on static rendering / page files to confirm nothing about removing JSX affects prerendering (it does not; no request APIs are introduced).

### 2. Remove the `/blog` heading

- In `apps/website/src/app/(main)/blog/page.tsx`, delete `<h1 className="text-4xl font-hand font-bold mb-8">Blog</h1>` and the empty line following it.
- Keep the outer `<div className="p-4 md:p-12">`, the `metadata` export, the empty-state `<p>` and the `<ul>` of posts (with its `h2` titles) exactly as they are.

### 3. Remove the `/shop` heading and its wrapper

- In `apps/website/src/app/(main)/shop/page.tsx`, delete the whole block:
  ```
  <div className="p-4 md:p-12">
    <h1 className="text-4xl font-hand font-bold">Shop</h1>
  </div>
  ```
  and the empty line after it.
- Keep the outer `<div>` and the `<section aria-label="Products" className="bg-shop-ground px-4 py-10 md:px-12 md:py-16">` unchanged, and the `metadata` export (title, description, canonical) unchanged.

### 4. Remove the `/contact` heading

- In `apps/website/src/app/(main)/contact/page.tsx`, delete `<h1 className="text-4xl text-header mb-6">Contact</h1>` and the empty line following it.
- Keep the outer `<div className="p-4 md:p-12">`, the `page-decor-photo` image block (with its `mb-8`) and the text. Do not add a `metadata` export.

### 5. Add the browser regression test

- Create `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx`, modelled on `shop/ui/ProductCard.browser.test.tsx`:
  - `vi.mock("next/link", …)` rendering a plain `<a>` (same stand-in as ProductCard/Breadcrumb tests, with a one-line comment pointing at them).
  - `vi.mock("next/image", …)` rendering a plain `<img src alt>`.
  - `vi.mock("@/lib/blog/posts", …)` returning `allPosts` with one `BlogPost` fixture (slug, title, description, a valid `"yyyy-MM-dd"` date string, `hero` with `src`/`alt`, and a trivial component for the body — match the `BlogPost` type in `src/lib/blog/schema.ts`). Comment why: the real registry imports `.mdx`, which Vite browser mode cannot transform.
  - Import the three default exports after the mocks: `./blog/page`, `./shop/page`, `./contact/page`.
  - A `test.each` (or three tests) over `[["/blog", BlogIndexPage], ["/shop", ShopIndexPage], ["/contact", ContactPage]]` that renders the page component with `render(<Page />)` from `vitest-browser-react` and asserts `screen.container.querySelector("h1")` is `null` **and** that `getByRole("heading", { level: 1 })` has no match (e.g. `expect(queryByRole…)`-equivalent: `expect(getByRole("heading", { level: 1 }).query()).toBeNull()`).
  - Add one positive sanity assertion per page so the test cannot pass on an empty render: blog shows the fixture post's `h2` (`getByRole("heading", { level: 2, name: <fixture title> })`), shop shows the `Products` region (`getByRole("region", { name: "Products" })`), contact shows the `Front yard and garden entrance` image.
  - For shop, additionally assert the `Products` section is the first element child of the page's root element (proves the empty padded wrapper is gone, not just the `h1`).
- Keep it component-scoped (the header is not rendered — it lives in the layout), per the "keep browser tests cheap" rule in `apps/website/AGENTS.md`.

### 6. Prove the test is a real gate (negative check)

- Temporarily reinstate the `<h1>` on one page (e.g. put `<h1 className="text-4xl text-header mb-6">Contact</h1>` back into `contact/page.tsx`), run `yarn workspace website vitest run --project browser src/app/\(main\)/index-pages-no-title-heading.browser.test.tsx`, confirm the corresponding case fails.
- Temporarily reinstate the shop wrapper `div` (without the `h1`) and confirm the first-child assertion fails.
- Revert both, re-run, confirm green. Record in the PR description that this was tried and reverted.

### 7. Visual check and screenshots

- Start the website on this run's own port (`PORT` per the root `AGENTS.md` Ports section; never assume 3000, never start telegram-router or guest-communication-agent).
- Capture `/blog`, `/shop`, `/contact` at 390 px and 1280 px wide. Confirm: content starts directly under the header, the active tab is underlined, no empty band where the title was, and on `/shop` at 1280 px the header's bottom border separates it from the `bg-shop-ground` section.
- Attach the six screenshots to the PR.

### 8. Run the Playwright integration specs

- Run `yarn workspace website test:integration` against this run's own port, to prove the detail-page headings asserted in `shop.integration.spec.ts`, `blog-booking-flow.integration.spec.ts` and `booking-calendar-close-scroll.integration.spec.ts` are intact. No new spec is added (see Test Coverage).

### 9. Run the Validation Commands

- Run every command in `Validation Commands` and confirm all pass. In the `build` output confirm `/blog`, `/shop` and `/contact` are still listed as static (prerendered), unchanged in kind from before.

## Test Coverage

- `apps/website/src/app/(main)/index-pages-no-title-heading.browser.test.tsx` (`*.browser.test.tsx`, gated on push and in CI): renders the `/blog`, `/shop` and `/contact` page components and asserts none contains an `h1`, and that `/shop`'s products section is the page's first child. Nothing currently catches a page-title heading (or the empty shop wrapper) being reintroduced; no existing spec or browser test asserts on these three index headings.
- No new Playwright spec: the change is a deletion within three pages, not a cross-page journey, and `e2e/` is not in CI, so a spec would not gate. The existing detail-page specs are run (step 8) to prove the untouched headings still render.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace (including the new test's `BlogPost` fixture)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser (chromium) projects pass, including the new index-pages test
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; `/blog`, `/shop`, `/contact` still prerender as static
- `yarn workspace website test:integration` - Existing Playwright specs pass on this run's port, proving blog post and product detail headings are intact

## Notes

- The page components are server components with no request APIs; removing JSX cannot change their static status, but the build output check confirms it.
- After the change, `src/app/(main)/blog/page.tsx` still renders `h2` post titles with no page-level `h1` above them; that outline gap is accepted by the issue (the header's `h1` is the page's `h1`). Do not "fix" it.
- If a reviewer asks for an SEO `h1`, that is a separate decision per the issue's Out of scope; do not add a visually hidden one here.
- Conventional commit, e.g. `chore(website): drop page-title headings on blog, shop and contact index pages`. No `Co-Authored-By` trailer (repo `AGENTS.md`).
