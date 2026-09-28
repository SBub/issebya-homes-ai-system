# Feature: Shop wishlist with email and mild marketing opt-in

## Metadata

issue_number: `138`
adw_id: `972c79dc`
issue_json: `{"number":138,"title":"Shop: wishlist — save a product to a wishlist with an email and a (mild) marketing opt-in, and keep who wished what", ...}` (full body in GitHub issue #138)

## Feature Description

A visitor on a product detail page (`/shop/[slug]`) can press "Add to wishlist" next to the price. An inline form opens (not a modal) with an email field, a marketing opt-in checkbox and a submit button. Submit stays disabled until the checkbox is ticked, and a short helper line explains why. On submit, a Server Action validates the input with Zod, checks the slug against the product registry, records the consent (email, the exact consent sentence shown, timestamp) in `shop_wishlist_contacts`, then records the wish (`email`, `product_slug`) in `shop_wishlist_items`. Saving the same product twice is idempotent and shows the same success copy. The owner reads both tables in Supabase Studio, so per product they can see who wants it. Nothing about who wished what ever reaches the browser.

## User Story

As a visitor browsing the shop
I want to save a piece I like to a wishlist with just my email
So that the house can let me know about it (and the occasional offer) without me creating an account

## Problem Statement

`/shop` is a static catalogue with no interactivity and no database involvement. The owner has no way to learn which products visitors want, or to reach those visitors later. Any contact capture must record GDPR-grade consent (an affirmative opt-in, with the exact wording agreed to), must not pollute `guest_contacts` (keyed by phone, which a wishlist visitor does not give), and must not leak other visitors' data.

## Solution Statement

- A new migration creates two service-role-only tables: `shop_wishlist_contacts` (one row per consenting email, with `marketing_opt_in = true` enforced by a check constraint and the consent copy stored verbatim) and `shop_wishlist_items` (one row per email + product slug, unique, cascading from the contact). RLS enabled, `anon`/`authenticated` revoked, no policies, `updated_at` trigger like `bookings`.
- A pure module `src/lib/shop/wishlist.ts` holds the copy constants and `wishlistSchema` (normalised email, registry-checked `productSlug`, `marketingOptIn: z.literal(true)`, empty `honeypot`). It imports only `zod` and the product registry, so it runs in the vitest node pool.
- A Server Action `addToWishlist(prevState, formData)` in `src/app/(main)/shop/[slug]/actions.ts` validates, silently accepts honeypot hits, rejects unknown slugs before any DB call, upserts consent, then inserts the item (unique violation = success), with Sentry spans and `captureException` as in `submitBooking`.
- A small `"use client"` island `WishlistForm.tsx` renders under the price on the (still prerendered) Server Component detail page, uses `useActionState`, remembers the email in `localStorage` after success, and fires PostHog `wishlist_form_opened` and `wishlist_item_added`.
- The product slug is the identity. A comment in `products.ts` records that slugs are now stable identifiers referenced by `shop_wishlist_items`.

## Relevant Files

Use these files to implement the feature:

- `README.md`, `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook, no DB reset, shared local Supabase).
- `apps/website/AGENTS.md` - read `node_modules/next/dist/docs/` before Next work; server components by default; Zod at every boundary; no Radix; which test layers gate (unit + browser gate, `e2e/` does not run in CI).
- `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` - required reading before writing the Server Action and form (Next docs are the source of truth, per website AGENTS.md).
- `apps/website/app_docs/nextjs-patterns-guide.md` - adding a Server Action and a client island to a prerendered route.
- `apps/website/app_docs/data-fetching-client.md` - mutating in a Server Action, never from the client.
- `apps/website/app_docs/client-form-guide.md` and `apps/website/app_docs/form-re-render-strategy.md` - `useActionState` form pattern; React resets uncontrolled inputs on submit.
- `apps/website/app_docs/zod-validation-guide.md` - schema conventions.
- `apps/website/app_docs/component-patterns-guide.md` - new component conventions.
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy voice (no bold, no em dashes, no emojis).
- `apps/website/app_docs/database/database-interaction-rules.md` - read before writing the migration. Note the shop tables are admin-only (no guest reads), so no view and no `access_token`; service-role-only posture instead, like `bookings`.
- `apps/website/app_docs/database/production-migrations.md` - how the migration reaches prod (the `dry-run` job must pass on the PR).
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md`, `apps/website/app_docs/testing/e2e_example.md` - test formats.
- `apps/website/app_docs/feature-6db7ada5-shop-product-grid.md` - how the shop registry, `ProductCard` and the detail page were built.
- `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md` - adding a browser test that gates; `optimizeDeps.include` list.
- `supabase/migrations/20260821120000_create_bookings_from_website.sql` - RLS/revoke posture and the `updated_at` trigger function pattern to copy.
- `supabase/migrations/20260828120000_grant_service_role_all_public.sql` - default privileges already grant `service_role` on new tables; no grant needed.
- `apps/website/src/lib/shop/products.ts` - `getProductBySlug`, `allProducts`; add the slug-stability comment.
- `apps/website/src/lib/shop/schema.ts` - `Product`, `formatPrice`; module-level style reference for `wishlist.ts`.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - detail page; renders the form under the price. Must stay a Server Component and stay prerendered.
- `apps/website/src/app/(main)/shop/ui/ProductCard.tsx` - must NOT change (a form inside a link is invalid HTML).
- `apps/website/src/app/(main)/booking/[type]/actions.ts` - Server Action pattern: `"use server"`, Sentry `startSpan`/`addBreadcrumb`/`captureException`, `createAdminClient()`, field errors.
- `apps/website/src/app/(main)/booking/[type]/validation.ts` - `emailSchema` pattern and the reason schemas live outside `"use server"` files.
- `apps/website/src/lib/shared/validation.ts` - `formatZodErrors`.
- `apps/website/src/lib/shared/supabase.ts` - `createAdminClient()` and `createClient()` (anon).
- `apps/website/src/lib/shared/guest-contacts.ts` - `UNIQUE_VIOLATION = "23505"` convention; NOT to be written to by this feature.
- `apps/website/src/app/(main)/booking/[type]/__tests__/actions.unit.test.ts` - how Server Actions are unit-tested with a mocked admin client and mocked `@sentry/nextjs`.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` - opt-in checkbox markup, `key={...attempt}` re-seeding, client wrapper around the Server Action firing PostHog.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.browser.test.tsx` - how a browser test mocks `../actions` and `@sentry/nextjs`.
- `apps/website/src/app/(main)/blog/ui/RoomSwitcher.tsx` - `posthog.capture` from a client component.
- `apps/website/e2e/shop.integration.spec.ts` - existing shop spec to extend.
- `apps/website/e2e/booking-flow.integration.spec.ts` - fixture seeding/cleanup via `createAdminClient()` in a spec.
- `apps/website/vitest.config.ts` - browser project `optimizeDeps.include` (already includes `posthog-js`, `zod`, `@sentry/nextjs`).
- `docs/conditional-docs.md` - add an entry for the feature doc if one is written.

### New Files

- `supabase/migrations/20260924120000_create_shop_wishlist.sql` - the two tables, checks, trigger, RLS + revokes.
- `apps/website/src/lib/shop/wishlist.ts` - copy constants, `wishlistSchema`, `WishlistFormState` type, `initialWishlistState`.
- `apps/website/src/lib/shop/__tests__/wishlist.unit.test.ts` - schema tests.
- `apps/website/src/app/(main)/shop/[slug]/actions.ts` - `addToWishlist` Server Action.
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` - Server Action tests with mocked admin client.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx` - `"use client"` island.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.browser.test.tsx` - component test.

## Implementation Plan

### Phase 1: Foundation

Migration for the two tables, and the pure `wishlist.ts` module (copy + schema) with its unit tests. Add the slug-stability comment to `products.ts`. Apply the migration to the shared local database with a non-destructive `supabase migration up` (never a reset).

### Phase 2: Core Implementation

The `addToWishlist` Server Action with its mocked-client unit tests, then the `WishlistForm` client island with its browser test.

### Phase 3: Integration

Render `WishlistForm` on `/shop/[slug]` under the price, confirm the route is still prerendered in the build output, and extend the Playwright shop spec with an end-to-end "wish twice, one row each" journey plus the `anon` permission check.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the required docs

- Read `node_modules/next/dist/docs/01-app/02-guides/forms.md` and `.../server-actions.md` (resolve `node_modules` at the repo root if not under `apps/website`).
- Read `apps/website/app_docs/client-form-guide.md`, `form-re-render-strategy.md`, `zod-validation-guide.md`, `branding-guidelines.md`, `database/database-interaction-rules.md`.
- Check the installed zod major version in `apps/website/package.json` (the booking `emailSchema` uses `z.string().email(...)`; follow whatever is idiomatic for that version).

### 2. Write the migration

- Create `supabase/migrations/20260924120000_create_shop_wishlist.sql` (timestamp must sort after `20260922120000`; if another migration landed later on `develop`, bump it). Contents:
  - Header comment: what the tables are for, that they are service-role-only and edited in Supabase Studio (CRM convention), that `guest_contacts` is deliberately not used (keyed by phone), and that `product_slug` references the static registry in `apps/website/src/lib/shop/products.ts` (no FK possible).
  - `create table public.shop_wishlist_contacts (email text primary key, marketing_opt_in boolean not null, opted_in_at timestamptz not null, opt_in_copy text not null, source text not null default 'shop_wishlist', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint shop_wishlist_contacts_consent_required check (marketing_opt_in = true), constraint shop_wishlist_contacts_email_normalised check (email = lower(btrim(email))));`
  - `alter table public.shop_wishlist_contacts enable row level security;` then `revoke all on public.shop_wishlist_contacts from anon, authenticated;`
  - `create table public.shop_wishlist_items (id uuid primary key default gen_random_uuid(), email text not null references public.shop_wishlist_contacts(email) on delete cascade, product_slug text not null, created_at timestamptz not null default now(), unique (email, product_slug));`
  - `alter table public.shop_wishlist_items enable row level security;` then `revoke all on public.shop_wishlist_items from anon, authenticated;`
  - An index on `shop_wishlist_items (product_slug)` for the owner's "who wants this piece" query (the unique index leads with `email`, so it does not serve that).
  - `create or replace function public.update_shop_wishlist_contacts_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end; $$;` and a `before update ... for each row` trigger, mirroring `bookings`.
  - No policies (service role bypasses RLS). No grants (the default privileges from `20260828120000` already grant `service_role`).
- Apply to the shared local DB non-destructively from the repo root: `yarn supabase migration up`. Do NOT run `supabase start`, `supabase db reset` or `yarn supabase:reset`.
- Sanity check with psql against the local DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`): `set role anon; select * from public.shop_wishlist_items;` must fail with `42501` (permission denied), not return 0 rows; same for `shop_wishlist_contacts`. Also confirm `insert ... (marketing_opt_in) values (false)` and an email with uppercase/whitespace are rejected by the check constraints. Clean up any rows inserted.

### 3. Mark slugs as stable identifiers

- In `apps/website/src/lib/shop/products.ts`, add to the module docblock: slugs are now stable identifiers stored in `public.shop_wishlist_items.product_slug`; renaming a slug orphans every wish recorded against it, so do not rename casually (if a rename is unavoidable, migrate the rows in the same PR). No other registry change.

### 4. Create `src/lib/shop/wishlist.ts`

- Module docblock: imports only `zod` and the registry, so it runs in the node pool; lives outside `actions.ts` because a `"use server"` file may only export async functions.
- Copy constants, exact text, no em dashes:
  - `WISHLIST_OPT_IN_COPY = "Keep me posted about new pieces and the occasional offer from the house."`
  - `WISHLIST_OPT_IN_HELPER = "To save this to your wishlist we need your OK to send the odd update. No spam, unsubscribe any time."`
  - `WISHLIST_SUCCESS_COPY = "Saved. We'll let you know about it."`
  - A generic `WISHLIST_ERROR_COPY` for DB failures, e.g. `"Sorry, that did not save. Please try again in a moment."` (branding voice, no em dash).
- `wishlistSchema = z.object({...})`:
  - `email`: `z.string().trim().toLowerCase()` then the email check with the same message as the booking `emailSchema` ("Please enter a valid email address"), so the stored value satisfies `email = lower(btrim(email))`. Add a `.max(254)`.
  - `productSlug`: `z.string().refine((slug) => getProductBySlug(slug) !== undefined, { message: "Unknown product" })`.
  - `marketingOptIn`: `z.literal(true, { message: WISHLIST_OPT_IN_HELPER })` (use the zod-version-correct error option). Input is the boolean derived from the checkbox (`formData.get("marketingOptIn") === "on"`).
  - `honeypot`: `z.string().max(0)`.
- Export `type WishlistInput = z.infer<typeof wishlistSchema>`.
- Export the form state type and initial value:
  - `type WishlistFormState = { attempt: number; ok: boolean; errors: Partial<Record<"email" | "marketingOptIn" | "productSlug", string>>; generalError: string; email: string }`. `email` echoes the visitor's own submitted email only so the uncontrolled input can be re-seeded after React's form reset (same reason as `BookingFormState.values`). Nothing else is returned; never return rows or other people's data.
  - `initialWishlistState: WishlistFormState`.
- Export a small helper `wishlistInputFromFormData(formData)` that builds the raw object (`email`, `productSlug`, `marketingOptIn: formData.get("marketingOptIn") === "on"`, `honeypot: String(formData.get("website") ?? "")`) so the action and tests share one mapping. The honeypot field is named `website` in the DOM (bots fill it; humans never see it).
- Only export what production code uses (knip).

### 5. Unit-test the schema

- Create `apps/website/src/lib/shop/__tests__/wishlist.unit.test.ts` using a real registry slug (`allProducts[0].slug`):
  - valid input passes; `"  Guest@Example.COM "` parses to `"guest@example.com"`.
  - `marketingOptIn: false` fails, issue path `marketingOptIn`, message equals `WISHLIST_OPT_IN_HELPER`.
  - unknown slug (`"does-not-exist"`) fails on `productSlug`.
  - invalid email fails on `email` with "Please enter a valid email address".
  - filled honeypot fails on `honeypot`.
  - `wishlistInputFromFormData` maps an unticked checkbox (absent key) to `false` and `"on"` to `true`.
- Negative check (required by the issue): temporarily replace `z.literal(true)` with `z.boolean()`, run `yarn turbo run test --filter=./apps/website`, confirm the unticked-opt-in test fails, then revert. Record in the PR description that this was tried and reverted.

### 6. Create the Server Action

- `apps/website/src/app/(main)/shop/[slug]/actions.ts`, `"use server"`, exporting only `addToWishlist(prevState: WishlistFormState, formData: FormData): Promise<WishlistFormState>` (the `prevState` parameter is what `useActionState` requires; the issue's `addToWishlist(formData)` is shorthand).
- Flow:
  1. `attempt = prevState.attempt + 1`; build raw input with `wishlistInputFromFormData`; `const email = raw.email.trim()` for echo.
  2. `wishlistSchema.safeParse(raw)`.
  3. If the failure includes a `honeypot` issue: `addBreadcrumb({ category: "shop", message: "Wishlist honeypot tripped", level: "info" })` and return the success shape (`ok: true`) with no DB call. Honeypot is checked before anything else so a bot never learns which field tripped it.
  4. Other failures: return `ok: false` with `errors` built from `formatZodErrors` (first message per field). An unknown slug returns `errors.productSlug` and makes no `createAdminClient()` call (the 400 equivalent for a Server Action).
  5. `startSpan({ name: "shop.wishlist.add", op: "http.server", attributes: { "http.route": "shop.addToWishlist", "shop.productSlug": productSlug } }, ...)`:
     - `const supabase = createAdminClient();`
     - Upsert consent: `supabase.from("shop_wishlist_contacts").upsert({ email, marketing_opt_in: true, opted_in_at: new Date().toISOString(), opt_in_copy: WISHLIST_OPT_IN_COPY, source: "shop_wishlist" }, { onConflict: "email" })`. `opt_in_copy` comes from the server constant, never from the form. `updated_at` is set by the trigger. If error: `captureException(error, { tags: { "db.operation": "shop_wishlist_contacts_upsert" } })`, return `ok: false, generalError: WISHLIST_ERROR_COPY`, and do NOT insert the item.
     - Insert item: `supabase.from("shop_wishlist_items").insert({ email, product_slug: productSlug })`. If `error?.code === "23505"` (already wished) treat as success. Any other error: `captureException` with `db.operation: shop_wishlist_items_insert`, return the error shape.
     - Return `{ attempt, ok: true, errors: {}, generalError: "", email }`.
  - Do not put the email in Sentry breadcrumbs, tags or span attributes (only the slug).

### 7. Unit-test the Server Action

- Create `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`, modelled on `booking/[type]/__tests__/actions.unit.test.ts`: `vi.mock("@/lib/shared/supabase", () => ({ createAdminClient: mockCreateAdminClient }))` returning `{ from: mockFrom }`, where `mockFrom(table)` returns per-table `{ upsert, insert }` mocks recording call order; `vi.mock("@sentry/nextjs", ...)` with pass-through `startSpan`.
- Tests:
  - happy path: contacts `upsert` is called before items `insert` (assert via `mock.invocationCallOrder`); upsert payload has `marketing_opt_in: true`, `opt_in_copy === WISHLIST_OPT_IN_COPY`, lowercased email, `onConflict: "email"`; insert payload `{ email, product_slug }`; returns `ok: true`.
  - items insert returns `{ error: { code: "23505" } }` → returns `ok: true`, no `captureException`.
  - unknown slug → `ok: false`, `errors.productSlug` set, `createAdminClient` never called.
  - unticked opt-in → `ok: false`, `errors.marketingOptIn === WISHLIST_OPT_IN_HELPER`, nothing called.
  - honeypot filled (with otherwise valid input) → `ok: true`, `createAdminClient` never called.
  - contacts upsert error → `ok: false` with `generalError`, items insert never called, `captureException` called.
  - result keys are exactly `attempt, ok, errors, generalError, email` (no leak of DB data).

### 8. Build the `WishlistForm` client island

- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.tsx`, `"use client"`, props `{ productSlug: string }`.
- Closed state: a `type="button"` "Add to wishlist" button with `aria-expanded={isOpen}` and `aria-controls` the form id. Its `onClick` (event handler, no `useEffect`): sets `isOpen`, fires `posthog.capture("wishlist_form_opened", { product_slug: productSlug })`, and reads remembered values from `localStorage` inside try/catch into state (`rememberedEmail`, `rememberedConsent` = stored consent email equals stored email). Reading in the click handler, not during render, keeps the prerendered HTML and first client render identical (no hydration mismatch).
- `localStorage` keys: `issebya.shop.wishlist.email` and `issebya.shop.wishlist.consentEmail`. All reads and writes in try/catch (private mode, disabled storage). Stored values are a convenience only; the server never sees them as consent.
- Open state: an inline `<form id=... action={formAction} noValidate>` (no modal):
  - `<label>` + `<input type="email" name="email" autoComplete="email" required>` with `key={\`email-${state.attempt}\`}`and`defaultValue={state.attempt ? state.email : rememberedEmail}`; `aria-invalid`+`aria-describedby`to the field error when`state.errors.email`.
  - Hidden `<input type="hidden" name="productSlug" value={productSlug}>`.
  - Honeypot: a `name="website"` text input inside a wrapper that is visually hidden and `aria-hidden="true"`, with `tabIndex={-1}` and `autoComplete="off"`, plus a label so it is not flagged by lint.
  - Checkbox `name="marketingOptIn"`, controlled `checked={optedIn}` with `useState(rememberedConsent)` seeded when the form opens (the form is only mounted once open, so seed at mount). Label text is `WISHLIST_OPT_IN_COPY` exactly, plain text, no bold.
  - Submit button "Save to wishlist", `disabled={!optedIn || isPending}`, `aria-describedby` the helper when unticked.
  - Helper `<p>` with `WISHLIST_OPT_IN_HELPER`, rendered only when `!optedIn`, directly under the submit button.
  - `state.errors.marketingOptIn` / `state.errors.productSlug` / `state.generalError` shown in a `role="alert"` paragraph (styled like the booking form's `text-red-500 text-sm`).
  - On `state.ok`: replace the form with a `role="status"` paragraph containing `WISHLIST_SUCCESS_COPY`.
- `useActionState` wraps a client function (same pattern as `BookingEngineExpanded`'s client wrapper around `submitBooking`): `async (prev, formData) => { const next = await addToWishlist(prev, formData); if (next.ok) { rememberWishlistEmail(next.email); posthog.capture("wishlist_item_added", { product_slug: productSlug }); } return next; }`. `rememberWishlistEmail` writes both keys in try/catch. The honeypot path also returns `ok: true`, which is fine (a bot's localStorage is irrelevant).
- Styling: Tailwind utilities consistent with the detail page (`text-sm`, `uppercase tracking-[0.2em] text-xs` for the button if it matches the brand line, border inputs like the booking form). No Radix, no new dependencies.

### 9. Browser-test the form

- Create `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.browser.test.tsx`, component-scoped, modelled on `BookingEngineExpanded.browser.test.tsx`:
  - `vi.mock("../actions", () => ({ addToWishlist: mockAddToWishlist }))`, `vi.mock("posthog-js", () => ({ default: { capture: mockCapture } }))`, `vi.mock("@sentry/nextjs", ...)` if the import graph pulls it in.
  - clicking "Add to wishlist" reveals the email field and checkbox and captures `wishlist_form_opened` with `{ product_slug }`.
  - submit is disabled and the helper text is visible while the checkbox is unticked; ticking enables submit and hides the helper.
  - filling the email, ticking and submitting with `mockAddToWishlist` resolving `{ attempt: 1, ok: true, errors: {}, generalError: "", email: "guest@example.com" }` shows `WISHLIST_SUCCESS_COPY`, captures `wishlist_item_added`, and writes the email to `localStorage`.
  - with `localStorage` pre-seeded with the email and consent email, opening the form prefills the email and the checkbox starts checked. Clear `localStorage` in `beforeEach`.
- Confirm nothing new must be added to `optimizeDeps.include` in `vitest.config.ts` (`posthog-js`, `zod` are already listed); add any new dep that the run reports as optimised mid-run.

### 10. Render it on the detail page

- In `apps/website/src/app/(main)/shop/[slug]/page.tsx`, render `<WishlistForm productSlug={product.slug} />` directly under the price `<p>` (before `details`). The page stays a Server Component; no `searchParams`, `cookies()` or `headers()` introduced. Do not touch `ProductCard.tsx` or `/shop/page.tsx`.

### 11. Extend the Playwright shop spec

- In `apps/website/e2e/shop.integration.spec.ts` (update the header comment: the wishlist test now seeds/cleans up rows), add a `test.describe("Wishlist")` block:
  - Use a unique email `e2e-wishlist-${randomUUID()}@example.com`; `afterEach` deletes the contact via `createAdminClient()` (items cascade).
  - Go to `/shop/${firstProduct.slug}`, click "Add to wishlist", fill email, assert submit disabled and helper visible, tick the checkbox (by its exact label), submit, assert `WISHLIST_SUCCESS_COPY` visible.
  - Reload, open again (email prefilled from `localStorage`), tick if needed, submit again, assert the success copy again.
  - Query with `createAdminClient()`: exactly one `shop_wishlist_items` row for `(email, firstProduct.slug)`, exactly one `shop_wishlist_contacts` row with `marketing_opt_in = true` and `opt_in_copy === WISHLIST_OPT_IN_COPY`.
  - `anon` cannot read: `createClient().from("shop_wishlist_items").select("*")` returns `error.code === "42501"` (and the same for contacts), not an empty array.
- This spec fails without the feature (no button, no tables). It runs in the ADW test phase via `yarn workspace website test:integration`, not in CI, which is why the gating coverage lives in the unit and browser tests above.

### 12. Document

- Leave the `app_docs/feature-972c79dc-*.md` write-up and its `docs/conditional-docs.md` entry to the document phase, but make sure code comments explain: why slug is the identity, why consent copy is a server constant, why the honeypot returns success, why `localStorage` is read in the click handler.

### 13. Run the validation commands

- Run every command in `Validation Commands` and fix anything that fails. In the build output, confirm `/shop/[slug]` is still listed as prerendered (SSG), not dynamic.

## Testing Strategy

### Unit Tests

- `wishlist.unit.test.ts` (node pool): schema acceptance/rejection per field, email normalisation, checkbox mapping.
- `actions.unit.test.ts` (node pool): the action's ordering, idempotency, early exits and error handling against a mocked `createAdminClient()`.

### Test Coverage

- `apps/website/src/lib/shop/__tests__/wishlist.unit.test.ts` (`*.unit.test.ts`): catches consent no longer being a hard gate (e.g. `z.literal(true)` loosened), unknown slugs being accepted, and un-normalised emails that would violate the DB check. Fails today (module does not exist).
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` (`*.unit.test.ts`): catches the item being written before (or without) the consent row, a duplicate wish surfacing as an error, an unknown slug or honeypot hit reaching the database, and the response leaking anything beyond the success/error shape.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistForm.browser.test.tsx` (`*.browser.test.tsx`): catches the submit becoming clickable without consent, the helper copy disappearing, the success copy not rendering, and the remembered-email prefill regressing. Gates on push and in CI.
- `apps/website/e2e/shop.integration.spec.ts` (Playwright, extended): proves the real journey against the shared local DB: same product twice gives one item row and one contact row with the exact consent copy, and `anon` gets `42501`. Not in CI by design.

### Edge Cases

- Checkbox unticked: submit disabled in the UI; if forced (devtools), the server rejects with the helper message and writes nothing.
- Same email, same product twice: one item row, same success copy (unique violation treated as success).
- Same email, different products: one contact row (consent refreshed: `opted_in_at`, `opt_in_copy`, `updated_at`), two item rows.
- Email with uppercase or surrounding spaces: stored lowercased and trimmed; matches the DB check.
- Unknown or tampered `productSlug`: field error, no DB call.
- Honeypot filled: success shape, no DB call.
- `localStorage` unavailable or throwing: form still works, just no prefill.
- DB error on the contact upsert: error copy shown, item not inserted, Sentry captured.
- Prerender: `/shop/[slug]` still static; no hydration mismatch because `localStorage` is read only after a click.

## Acceptance Criteria

- Migration `supabase/migrations/<ts>_create_shop_wishlist.sql` creates both tables exactly as specified (types, defaults, `marketing_opt_in = true` check, `email = lower(btrim(email))` check, FK with `on delete cascade`, `unique (email, product_slug)`), enables RLS, revokes all from `anon` and `authenticated`, adds the `updated_at` trigger, and passes the `dry-run` job.
- `select` on either table as `anon` fails with `42501`.
- `products.ts` carries the slug-stability comment; no other registry change; no numeric product id introduced.
- `/shop/[slug]` shows "Add to wishlist" next to/under the price; clicking opens an inline form (no modal); `ProductCard` and `/shop` are unchanged.
- Checkbox label is exactly "Keep me posted about new pieces and the occasional offer from the house."; submit is disabled while unticked with the helper "To save this to your wishlist we need your OK to send the odd update. No spam, unsubscribe any time." underneath; success shows "Saved. We'll let you know about it."; a repeat wish shows the same success text.
- `opt_in_copy` stored equals the label text, taken from a server-side constant.
- The action returns only the success/error shape; nothing about other visitors is exposed; no page lists wishes; no email is sent; `guest_contacts` is not touched.
- PostHog events `wishlist_form_opened` and `wishlist_item_added { product_slug }` fire.
- Email remembered in `localStorage` after success and prefilled next time; reads/writes wrapped in try/catch.
- Negative check performed (loosening `z.literal(true)` fails the schema test) and reverted.
- All validation commands pass; `/shop/[slug]` still prerendered in the build route table.
- Manual on the PR preview (reviewer step, after the migration reaches the preview DB): add a product twice with the same email, paste the resulting two rows (email redacted) into the PR.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn supabase migration up` - Applies the new migration to the shared local DB without resetting it (run from the repo root; never `db reset`)
- `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "set role anon; select * from public.shop_wishlist_items;"` - Must fail with `permission denied` (42501), proving the revoke
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser tests pass, proving the feature works with zero regressions
- `yarn turbo run build --filter=./apps/website` - Production build succeeds, and the route table still shows `/shop/[slug]` as prerendered

## Notes

- No new dependencies.
- The action's signature is `addToWishlist(prevState, formData)` because `useActionState` passes the previous state first; the issue's `addToWishlist(formData)` is shorthand.
- `database-interaction-rules.md` describes a view + `access_token` pattern for guest-readable tables. These tables are never read by guests, so they follow the stricter service-role-only posture of `bookings` (RLS on, revoked, no policies), as the issue requires.
- The migration must reach production through the normal `migrations.yml` flow before the feature works on prod; on a preview without the tables the action will return the generic error copy and capture to Sentry.
- `localStorage` "prior consent" only pre-ticks the box for convenience. Every submit still sends the checkbox value and the server re-validates and re-records consent (`opted_in_at`, `opt_in_copy`), so the DB always reflects the latest affirmative opt-in.
- Follow-ups (out of scope): double opt-in / confirmation email, unsubscribe endpoint, rate limiting beyond the honeypot, owner-facing view of wishes per product, wishlist on `ProductCard`.
