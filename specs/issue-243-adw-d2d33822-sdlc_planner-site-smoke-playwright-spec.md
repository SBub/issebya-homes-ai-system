# Chore: Playwright smoke spec for the home redirect, header, footer and static pages

## Metadata

issue_number: `243`
adw_id: `d2d33822`
issue_json: `{"number":243,"title":"test(website): Playwright smoke spec for the home redirect, header, footer and static pages"}`

## Chore Description

Add one Playwright integration spec, `apps/website/e2e/site-smoke.integration.spec.ts`, covering the site's entry and static pages, none of which has e2e coverage today:

1. `/` and `/booking` both redirect to `/booking/room1`.
2. Header navigation: every nav link reaches its URL and is the only one carrying `border-b-2`; the `issebya.homes` logo returns to `/booking/room1`.
3. Footer: `Terms & Conditions` and `Privacy Policy` reach their pages (matching `h1`); the Instagram link's `href`, `target` and `rel` are correct (never clicked).
4. `/contact`: the "For custom bookings" copy and the WhatsApp link (`href` `WHATSAPP_URL`, name containing `WHATSAPP_DISPLAY_NUMBER`, `target="_blank"`, `rel` containing `noopener`, never clicked).
5. `/guest-info`: `h1` "Guest Info", seven section links; clicking `Parking` sets `#parking`, marks the link active and scrolls `#parking` into view (polling assertion).
6. Noindex: with the WhatsApp user agent, `<head>` of `/privacy-policy`, `/terms-and-conditions`, `/guest-info` carries `<meta name="robots" content="noindex, nofollow">`; `/contact`'s carries no noindex.
7. `/robots.txt` and `/sitemap.xml` content.

Test-only. No change under `src/`, no database, no fixtures, no external navigation.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md`, `apps/website/AGENTS.md` - repo and workspace rules; the latter states the `e2e/` suite is not in CI and runs in the ADW test phase only.
- `.adw/project.md` - commands, port rule (`PORT` from `.ports.env`, never `CI=1`), protected actions.
- `apps/website/playwright.config.ts` - `baseURL` from `PORT`, `workers: 1`, 30s per-test timeout, `reuseExistingServer`.
- `apps/website/app_docs/testing/e2e_example.md` - conventions for a Playwright spec under `e2e/` (per `docs/conditional-docs.md`).
- `apps/website/app_docs/feature-78e55892-booking-close-scroll-target.md` - smooth scroll is asynchronous; assert scroll with a polling assertion, never once right after the click.
- `apps/website/e2e/lockin-waitlist.integration.spec.ts` - the `WHATSAPP_UA` (`WhatsApp/2.23.20.0 A`) request pattern and the `<head>` slice + robots regex to reuse.
- `apps/website/e2e/shop.integration.spec.ts` - precedent for importing `SITE_URL` from `@/lib/site` in a spec and for `test.describe` style.
- `apps/website/e2e/booking-calendar-close-scroll.integration.spec.ts` - precedent for `toBeInViewport` / `not.toBeInViewport` after a scroll.
- `apps/website/src/app/(main)/page.tsx`, `apps/website/src/app/(main)/booking/page.tsx` - both `redirect("/booking/room1")`.
- `apps/website/src/app/(main)/layout.tsx` - renders `Header` and `Footer` around every `(main)` page.
- `apps/website/src/app/ui/Header.tsx` - logo link `issebya.homes` to `/` (hidden on `/` only); links Booking, Lock-in, Blog, Shop, Contact; active link gets `border-b-2` via `pathname.startsWith(section)`.
- `apps/website/src/app/ui/Footer.tsx`, `apps/website/src/app/ui/InstagramLink.tsx` - footer links and Instagram anchor (`aria-label="Instagram"`).
- `apps/website/src/app/ui/WhatsAppLink.tsx`, `apps/website/src/lib/site.ts` - `WHATSAPP_URL` (`https://wa.me/351920742845`), `WHATSAPP_DISPLAY_NUMBER` (`+351 920 742 845`), `SITE_URL` (`https://issebya.com`).
- `apps/website/src/app/(main)/contact/page.tsx` - contact copy; no robots metadata.
- `apps/website/src/app/(main)/guest-info/page.tsx`, `apps/website/src/app/(main)/guest-info/layout.tsx`, `apps/website/src/app/ui/InfoSection.tsx` - section nav, `hashchange` handler (active class + smooth `scrollIntoView`), `<section id>` with `scroll-mt-48`, noindex metadata.
- `apps/website/src/app/(main)/privacy-policy/page.tsx`, `apps/website/src/app/(main)/terms-and-conditions/page.tsx` - `h1`s and noindex metadata.
- `apps/website/src/app/robots.ts`, `apps/website/src/app/sitemap.ts` - expected robots and sitemap content.
- `knip.json` - `apps/website` already lists `e2e/**/*.ts` as entry, so the new spec needs no knip change.

### New Files

- `apps/website/e2e/site-smoke.integration.spec.ts` - the smoke spec.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the conventions

- Read `apps/website/app_docs/testing/e2e_example.md` and `apps/website/app_docs/feature-78e55892-booking-close-scroll-target.md`, and skim `e2e/lockin-waitlist.integration.spec.ts` and `e2e/booking-calendar-close-scroll.integration.spec.ts` for style.

### 2. Create `apps/website/e2e/site-smoke.integration.spec.ts` skeleton

- Imports: `{ expect, test, type Page } from "@playwright/test"` (only what is used) and `{ SITE_URL, WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site"`.
- A short top comment: no database, no fixtures; external links are asserted by attribute and never followed.
- `const WHATSAPP_UA = "WhatsApp/2.23.20.0 A";` with the same one-line rationale as the waitlist spec (HTML-limited bot, metadata lands in `<head>`).
- `const ACTIVE = /\bborder-b-2\b/;` used with `toHaveClass` / `not.toHaveClass`.
- A helper `headOf(html)` returning `html.slice(0, html.indexOf("</head>"))`, and asserting `</head>` was found (index > 0) so a missing head cannot silently yield the whole doc.
- Wrap everything in `test.describe("Site smoke", ...)`.

### 3. Test 1: home redirects

- One test: `await page.goto("/")` then `await expect(page).toHaveURL(/\/booking\/room1$/)`; then the same for `page.goto("/booking")`.

### 4. Test 2: header navigation

- Define `const NAV = [{ name: "Lock-in", url: "/lock-in/room1" }, { name: "Blog", url: "/blog" }, { name: "Shop", url: "/shop" }, { name: "Contact", url: "/contact" }] as const;`.
- A test `"Booking is the active header link on /booking/room1"`: goto `/booking/room1`; `const header = page.locator("header")`; `header.getByRole("link", { name: "Booking", exact: true })` `toHaveClass(ACTIVE)`; every `NAV` link `not.toHaveClass(ACTIVE)`.
- Generate one test per `NAV` entry (`for (const { name, url } of NAV) test(...)`), each starting from `page.goto("/booking/room1")`, clicking `header.getByRole("link", { name, exact: true })`, then `await expect(page).toHaveURL(new RegExp(`${url}$`))` (escape-free: none of the URLs contain regex metacharacters other than `/`, or build with `` `${url}` `` and a `toHaveURL` predicate `(u) => u.pathname === url`; prefer the predicate form), then that link `toHaveClass(ACTIVE)` and `Booking` `not.toHaveClass(ACTIVE)`. One test per link keeps each well under the 30s timeout while the dev server compiles each route on first hit.
- A test for the logo: goto `/contact`, click `header.getByRole("link", { name: "issebya.homes" })`, expect pathname `/booking/room1` (it navigates to `/` which redirects).
- Every locator in these tests is scoped to `page.locator("header")`.

### 5. Test 3: footer links

- For `{ name: "Terms & Conditions", url: "/terms-and-conditions" }` and `{ name: "Privacy Policy", url: "/privacy-policy" }`, one test each: goto `/contact`, `const footer = page.locator("footer")`, click `footer.getByRole("link", { name, exact: true })`, expect pathname `url`, expect `page.getByRole("heading", { level: 1, name })` visible.
- A test for Instagram: goto `/contact`, `const ig = page.locator("footer").getByRole("link", { name: "Instagram" })`; assert `toHaveAttribute("href", "https://www.instagram.com/issebya.homes")`, `toHaveAttribute("target", "_blank")`, `toHaveAttribute("rel", "noopener noreferrer")`. Do not click.

### 6. Test 4: contact page

- goto `/contact`; `page.getByText(/^For custom bookings, special requests/)` visible.
- `const wa = page.getByRole("link", { name: /WhatsApp/ })` scoped to `page.locator("main")` if the contact page renders inside the layout's `<main>`; otherwise scope by excluding header/footer (the WhatsApp link only appears in the page body, so a page-level role locator is unique; confirm with `toHaveCount(1)`).
- Assert `toHaveAttribute("href", WHATSAPP_URL)`, `toHaveAccessibleName(new RegExp(escape(WHATSAPP_DISPLAY_NUMBER)))` or simpler `toContainText(WHATSAPP_DISPLAY_NUMBER)` (the name is the text), `toHaveAttribute("target", "_blank")`, `toHaveAttribute("rel", /noopener/)`. Do not click.

### 7. Test 5: guest info section nav and scroll

- `await page.setViewportSize({ width: 390, height: 844 })` so the page is long relative to the viewport (mobile layout, as in the close-scroll spec), then goto `/guest-info`.
- `page.getByRole("heading", { level: 1, name: "Guest Info" })` visible.
- Section nav links: `page.locator('nav a[href^="#"]')` `toHaveCount(7)` and `toHaveText([...seven titles in order])`.
- Precondition, so the scroll assertion means something: `await expect(page.locator("#parking")).not.toBeInViewport()`. If this fails at 390x844, the implementer must pick a smaller viewport height rather than drop the precondition.
- Click `page.getByRole("link", { name: "Parking", exact: true })`.
- `await expect(page).toHaveURL(/#parking$/)`; the Parking link `toHaveClass(ACTIVE)` (auto-retrying); `await expect(page.locator("#parking")).toBeInViewport()` (auto-retrying, so it waits out the smooth scroll; never a one-shot `isVisible`/`boundingBox` read right after the click).

### 8. Test 6: noindex

- One test per path in `["/privacy-policy", "/terms-and-conditions", "/guest-info"]`: `request.get(path, { headers: { "user-agent": WHATSAPP_UA } })`, status 200, `expect(headOf(html)).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/)`.
- One test for `/contact`: same fetch, status 200, `expect(headOf(html)).not.toMatch(/<meta name="robots"[^>]*noindex/)`. (The root layout sets no robots metadata, so a positive check that `<head>` contains other metadata, e.g. `<title>`, guards against an empty-head false pass: assert `headOf(html)` contains `<title>`.)

### 9. Test 7: robots.txt and sitemap.xml

- `request.get("/robots.txt")`: status 200; body `toMatch(/^Disallow: \/api\/$/m)`, `toMatch(/^Disallow: \/guest-info$/m)`, `toMatch(/^Sitemap: \S+\/sitemap\.xml$/m)` (or `toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)`, stronger, preferred).
- `request.get("/sitemap.xml")`: status 200; body contains `<loc>${SITE_URL}/contact</loc>`, `<loc>${SITE_URL}/terms-and-conditions</loc>`, `<loc>${SITE_URL}/privacy-policy</loc>`; `not.toContain("/guest-info")`.
- Assert nothing else about `/checkin`.

### 10. Run the new spec

- `source .ports.env` (fall back to 3000 only if absent); `prepare_app` server must already be up on that port. Run `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/site-smoke.integration.spec.ts`. Fix the spec (never `src/`) until green.

### 11. Negative checks (revert each; neither may appear in the diff)

- Remove the `robots` entry from `apps/website/src/app/(main)/guest-info/layout.tsx`, rerun the spec: the `/guest-info` noindex test must fail. `git checkout -- "apps/website/src/app/(main)/guest-info/layout.tsx"`.
- Change the footer's privacy `href` in `apps/website/src/app/ui/Footer.tsx` to `/privacy`, rerun: the Privacy Policy footer test must fail. `git checkout -- apps/website/src/app/ui/Footer.tsx`.
- Confirm `git status` shows only the new spec (plus this plan) changed.

### 12. Run the Validation Commands

- Run every command below; all must pass.

## Test Coverage

- `apps/website/e2e/site-smoke.integration.spec.ts` (Playwright, `apps/website/e2e/*.spec.ts` layer): catches a broken `/` or `/booking` redirect, a wrong header/footer `href` or active-link styling, a broken contact WhatsApp or Instagram link attribute, a regressed guest-info section nav (hash, active class, scroll), a lost `noindex` on the legal pages or guest info, and robots.txt/sitemap drift. None of this is covered by any spec today. This chore is itself the test; no unit or browser test is added because the behaviour is routing, metadata and real-browser scrolling, which only the integration layer exercises. Note per `apps/website/AGENTS.md` that this layer runs in the ADW test phase and manually, not in CI.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website` - the spec type-checks (Playwright types, `@/lib/site` imports).
- `yarn turbo run lint --filter=./apps/website` - ESLint over the new spec.
- `yarn prettier --check .` - formatting.
- `yarn knip` - no unused exports or files introduced (the spec is a knip entry via `e2e/**/*.ts`).
- `yarn turbo run test --filter=./apps/website` - Vitest unit and browser projects still pass (nothing in `src/` changes; guards against accidental edits).
- `yarn turbo run build --filter=./apps/website` - build still green.
- `PORT=$PORT yarn workspace website test:integration --project=chromium e2e/site-smoke.integration.spec.ts` - the new spec passes on this run's port (from `.ports.env`), reusing the `prepare_app` server; never set `CI=1`.
- `PORT=$PORT yarn workspace website test:integration --project=chromium` - the full integration suite still passes with the new spec in it.

## Notes

- No em dashes anywhere in the spec (comments included). Commit scope `website`, e.g. `test(website): add site smoke playwright spec`. No attribution trailers.
- Do not start a dev server, do not run any Supabase command; the spec needs no database.
- No user-visible flow changes, so no review screenshots beyond the profile's defaults and no `e2e/*.md` journey.
- Header nav at the default 1280 desktop width shows all links; keep tests 2 to 4 at the default viewport and only resize in test 5.
- `toHaveURL` with a predicate (`(url) => url.pathname === "/blog"`) avoids regex escaping and also rejects `/blog/...` matches.
- Clicking an in-page `#parking` anchor triggers both the browser's native anchor jump and the page's `hashchange` smooth scroll; either way the polling `toBeInViewport` is the right assertion, and the `not.toBeInViewport` precondition is what makes it meaningful.
- Dev-mode first compiles of `/shop`, `/blog` and `/lock-in/room1` can be slow; one test per link keeps each inside the 30s budget. If a single test still times out on a cold server, use `test.slow()` on that test rather than raising the global timeout.
