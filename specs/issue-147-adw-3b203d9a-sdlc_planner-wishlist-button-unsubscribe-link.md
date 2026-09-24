# Feature: Shop wishlist labelled button and a real unsubscribe link

## Metadata

issue_number: `147`
adw_id: `3b203d9a`
issue_json: `{"number":147,"title":"Shop wishlist: 'Add to wishlist' button with heart, and a real unsubscribe link in the confirmation email (follow-up to #143)"}`

## Feature Description

Follow-up to #143 (PR #146). Two changes to the wishlist on `/shop/[slug]`:

1. **Button.** The icon-only heart next to the price becomes a labelled outline button: heart icon + visible text `Add to wishlist`, which becomes `Added to wishlist` with a filled heart after a successful save. Visible text is the accessible name (no `aria-label`). Styled with the site's outline button recipe, extracted from `.booking-close-button` into a shop-neutral `.button-outline` class.
2. **Unsubscribe.** The confirmation email stops promising "Reply to this email to stop these" (nothing in the database changes on a reply) and instead ends with a real link, `${SITE_URL}/shop/wishlist/unsubscribe?token=<token>`. Clicking it flips the contact to unsubscribed without deleting the contact or any wished item. The schema gains a per-contact `unsubscribe_token` and an `unsubscribed_at` timestamp, with a CHECK that keeps `marketing_opt_in` and `unsubscribed_at` consistent. Re-consenting after an unsubscribe rotates the token, so an old email's link can never unsubscribe a renewed consent. The email also carries a `List-Unsubscribe` header.

## User Story

As a first-time visitor to a shop product page
I want a button that says "Add to wishlist", and an email whose unsubscribe link actually stops the emails
So that I understand what the button does, and I can withdraw consent in one click without losing what I wished for

## Problem Statement

- A bare heart next to a price does not read as "add to wishlist" to a first-time visitor.
- The confirmation email's "Reply to this email to stop these" is a promise nobody keeps automatically: a reply lands in the owner's inbox and the database still says the guest is opted in.
- The schema cannot represent "unsubscribed": `shop_wishlist_contacts_consent_required check (marketing_opt_in = true)` means the only way to stop email is deleting the contact row, which cascades away their wishes. The owner has no truthful record of who opted out and when.

## Solution Statement

- **Schema:** one migration adds `unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex')` and `unsubscribed_at timestamptz null`, swaps the consent CHECK for a two-state `shop_wishlist_contacts_consent_state` check. RLS and revokes unchanged; the token is used only server-side through `createAdminClient()`.
- **Pure logic in `src/lib/shop/unsubscribe.ts`:** token-shape check, `resolveUnsubscribe(supabase, token)` returning `"unsubscribed" | "already" | "invalid"` (race-safe update filtered by `unsubscribed_at is null`), result-path mapping, and a Sentry event scrubber that removes the token from request URLs/span data.
- **Route:** `/shop/wishlist/unsubscribe/page.tsx` is a thin dynamic Server Component: read `searchParams.token`, call the resolver, then `redirect()` to a token-free result page (`/shop/wishlist/unsubscribe/done` or `/already`) or `notFound()` (segment `not-found.tsx` says `This link isn't valid.`). All of this happens before any Suspense boundary so the HTTP status is real (redirect header / 404), and the token URL never renders HTML, so PostHog never sees it.
- **Action:** `addToWishlist` first reads the contact's `unsubscribed_at, unsubscribe_token`, then upserts; on re-consent (row had `unsubscribed_at` set) the payload sets `unsubscribed_at: null` and a fresh `randomBytes(32).toString("hex")` token. Email goes out when `created || reconsented`, with the post-upsert token.
- **Email:** `wishlistConfirmationEmailText` takes `unsubscribeUrl` and ends with `If you'd rather not receive these emails, unsubscribe here: ${unsubscribeUrl}`; `sendWishlistConfirmationEmail` takes `unsubscribeToken`, builds the URL from `SITE_URL`, and sends `headers: { "List-Unsubscribe": "<url>" }`. No `List-Unsubscribe-Post`.
- **Button:** `.button-outline` in `globals.css` (composed by `.booking-close-button`), button markup with heart + text.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo rules: yarn only, never reset the shared local Supabase, conventional commits.
- `apps/website/AGENTS.md` - read `node_modules/next/dist/docs/` before Next work; browser tests component-scoped; e2e not in CI.
- `docs/conditional-docs.md` - doc index; add an entry for the new feature doc.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md` - original wishlist design (consent recorded server-side, tables locked down). Its conditions explicitly cover "building anything that emails wishlist contacts (unsubscribe, offers)".
- `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md` - heart/dialog/email design from #143; describes the "reply to stop" wording being removed here.
- `apps/website/app_docs/nextjs-patterns-guide.md` - adding a route / Server Component.
- `apps/website/app_docs/database/database-interaction-rules.md` - "Token-Based Access" and "Token Rotation": token is the public accessor, rotatable, unique.
- `apps/website/app_docs/database/production-migrations.md` - the migration reaches prod via `.github/workflows/migrations.yml` (dry-run on PR).
- `apps/website/app_docs/branding-guidelines.md` - guest-facing copy: no bold, no em dashes, no emojis.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `component_test_spec_format.md`, `e2e_example.md` - test conventions.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` - `redirect()` in a Server Component is a 307 (303 only in Server Actions); becomes a client-side meta redirect if streaming already started.
- `node_modules/next/dist/docs/01-app/02-guides/streaming.md` ("The HTTP contract") - `notFound()`/`redirect()` must fire before any `<Suspense>`/streaming for a real status code.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md` - segment `not-found.tsx`.
- `supabase/migrations/20260924120000_create_shop_wishlist.sql` - current table, CHECK being replaced, header comment that says "no access_token".
- `supabase/migrations/20260925120000_create_shop_seller_submissions.sql` - latest migration; new one must sort after it.
- `supabase/migrations/20260821120000_create_bookings_from_website.sql` - `access_token` default pattern to copy.
- `apps/website/src/app/(main)/shop/[slug]/actions.ts` - `addToWishlist`: add the pre-read, re-consent/rotation, `shouldEmail`.
- `apps/website/src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` - Supabase mock needs `select().eq().maybeSingle()` for the contact pre-read and `upsert().select().single()` if the token is read back.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - trigger button markup.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` - asserts `aria-label` today; switch to accessible name / text.
- `apps/website/src/app/(main)/shop/[slug]/ui/HeartIcon.tsx` - unchanged, reused (`currentColor`, `aria-hidden`, `data-filled`).
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - places `WishlistDialog` beside the price; check layout still fits with a wider button (the `flex items-center gap-3` row may need `flex-wrap`).
- `apps/website/src/app/(main)/privacy-policy/page.tsx` - `robots: { index: false, follow: false }` precedent.
- `apps/website/src/app/(main)/booking/confirmation/page.tsx` - precedent for a dynamic page that awaits `searchParams` and calls `notFound()` before rendering, under `cacheComponents: true`.
- `apps/website/src/lib/shop/wishlist.ts` - copy constants and email text builder.
- `apps/website/src/lib/shop/__tests__/wishlist.unit.test.ts` - email-text tests (the "how to stop" test changes).
- `apps/website/src/lib/resend.ts` - `sendWishlistConfirmationEmail`.
- `apps/website/src/lib/__tests__/resend.unit.test.ts` - Resend mock tests.
- `apps/website/src/lib/site.ts` - `SITE_URL`.
- `apps/website/src/lib/shared/supabase.ts` - `createAdminClient()`.
- `apps/website/src/app/globals.css` - `.booking-close-button` recipe at line ~289.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineExpanded.tsx` - only user of `.booking-close-button`; must look identical after the extraction.
- `apps/website/sentry.server.config.ts` - `tracesSampleRate: 1`, `sendDefaultPii: true`: every request's URL (with `?token=`) would reach Sentry as transaction/span data. Wire the scrubber here.
- `apps/website/sentry.edge.config.ts` - same scrubber for parity (cheap; the route is not edge, but keep configs aligned only if trivial).
- `apps/website/src/instrumentation-client.ts` - PostHog `defaults: "2026-01-30"` captures `$current_url`; the redirect design keeps the token out of it. No change needed.
- `apps/website/src/instrumentation.ts` - `E2E_MOCK_RESEND` for the Playwright server.
- `apps/website/e2e/shop.integration.spec.ts` - wishlist e2e steps; add the unsubscribe steps.
- `apps/website/README.md` - shop/wishlist section: describe consent states.

### New Files

- `supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql` - token + `unsubscribed_at` + new consent-state CHECK, with a header comment explaining the state model and why the token exists.
- `apps/website/src/lib/shop/unsubscribe.ts` - pure/node-testable: `isUnsubscribeToken`, `newUnsubscribeToken`, `resolveUnsubscribe`, `unsubscribeResultPath`, `unsubscribeUrl`, `scrubUnsubscribeToken`.
- `apps/website/src/lib/shop/__tests__/unsubscribe.unit.test.ts` - resolver, rotation and scrubber tests.
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/page.tsx` - the dynamic token-consuming page (never renders; always redirects or 404s).
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/not-found.tsx` - `This link isn't valid.`
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/done/page.tsx` - `You're unsubscribed. We won't email you about the wishlist any more.` (static, noindex)
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/already/page.tsx` - `You're already unsubscribed.` (static, noindex)
- `apps/website/src/app/(main)/shop/wishlist/unsubscribe/ui/UnsubscribeMessage.tsx` - the one shared presentational block (heading-less paragraph + link back to `/shop`) so the three pages differ only in data.
- `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md` - feature doc (written by the document phase; listed so the conditional-docs entry is not forgotten).

## Implementation Plan

### Phase 1: Foundation

Schema migration applied to the shared local instance with `yarn supabase migration up` (never `db reset`), then the pure modules: copy constants in `wishlist.ts`, and `unsubscribe.ts` with its unit tests. These have no UI and no Next dependency, so they are built and proven first.

### Phase 2: Core Implementation

Email builder + Resend sender take the unsubscribe URL/token; `addToWishlist` gains the pre-read, re-consent with token rotation and the `created || reconsented` email rule; the unsubscribe route, its `not-found.tsx`, and the two token-free result pages.

### Phase 3: Integration

Button restyle and `.button-outline` extraction; Sentry scrubber wired into the server config; Playwright spec extended; README and docs index updated; full validation.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs this change depends on

- Read `apps/website/AGENTS.md`, `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`, `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md`, `apps/website/app_docs/database/database-interaction-rules.md`, `apps/website/app_docs/branding-guidelines.md`.
- Read from `node_modules/next/dist/docs/01-app/` (repo root `node_modules`): `03-api-reference/04-functions/redirect.md`, `03-api-reference/04-functions/not-found.md`, `03-api-reference/03-file-conventions/not-found.md`, `02-guides/streaming.md` section "The HTTP contract", and `01-getting-started/08-caching.md` around "Uncached data was accessed outside of <Suspense>" (the app runs `cacheComponents: true`).

### 2. Migration

- Create `supabase/migrations/20260926120000_add_shop_wishlist_unsubscribe.sql` with exactly the SQL from the issue:
  ```sql
  alter table public.shop_wishlist_contacts
    add column unsubscribe_token text not null unique
      default encode(extensions.gen_random_bytes(32), 'hex'),
    add column unsubscribed_at timestamptz null;

  alter table public.shop_wishlist_contacts
    drop constraint shop_wishlist_contacts_consent_required,
    add constraint shop_wishlist_contacts_consent_state check (
      (marketing_opt_in and unsubscribed_at is null)
      or (not marketing_opt_in and unsubscribed_at is not null)
    );
  ```
- Header comment: the two consent states (subscribed: `marketing_opt_in = true, unsubscribed_at is null`; unsubscribed: `false, not null`); unsubscribing never deletes the contact or any item; `unsubscribe_token` is now the one public accessor (supersedes the original migration's "no access_token" note), used only server-side via the service role from the unsubscribe page; RLS stays enabled with zero policies and the anon/authenticated revoke stays; the token is rotated by `addToWishlist` on re-consent so old links die; `gen_random_bytes` is volatile so each existing row gets its own token.
- Do not edit the original migration file (already applied in prod).
- Apply locally: `cd apps/website && yarn supabase migration up` (or from the directory holding `supabase/config.toml`; never `db reset`, never `supabase start`).
- Verify on the local instance and record the output for the PR:
  - `select count(*), count(distinct unsubscribe_token) from public.shop_wishlist_contacts;` (equal).
  - Four inserts inside a transaction that is rolled back (`begin; … rollback;`), each with a throwaway email: `(true, null)` accepted, `(false, now())` accepted, `(true, now())` rejected by `shop_wishlist_contacts_consent_state`, `(false, null)` rejected. Run each rejected insert in its own `begin/rollback` (or a savepoint) so one failure does not abort the others.
  - Use `psql` against the local DB URL from `yarn supabase status` in `apps/website`.

### 3. Copy constants and email text (`src/lib/shop/wishlist.ts`)

- Remove `WISHLIST_EMAIL_STOP_LINE`.
- Add:
  - `WISHLIST_UNSUBSCRIBE_LINE = "If you'd rather not receive these emails, unsubscribe here:"` (the builder appends ` ${unsubscribeUrl}`).
  - `WISHLIST_UNSUBSCRIBED_COPY = "You're unsubscribed. We won't email you about the wishlist any more."`
  - `WISHLIST_ALREADY_UNSUBSCRIBED_COPY = "You're already unsubscribed."`
  - `WISHLIST_UNSUBSCRIBE_INVALID_COPY = "This link isn't valid."`
- `wishlistConfirmationEmailText({ productName, productUrl, unsubscribeUrl })` returns:
  ```
  ${productName} is on your wishlist.
  ${productUrl}

  We'll write to you when there's news about it.

  If you'd rather not receive these emails, unsubscribe here: ${unsubscribeUrl}
  ```
  `WISHLIST_OPT_IN_COPY` is no longer quoted in the email (it stays the stored consent copy and the checkbox label).
- Update `src/lib/shop/__tests__/wishlist.unit.test.ts`: replace "carries the news line, the consent sentence and how to stop" with a test that the last line is `${WISHLIST_UNSUBSCRIBE_LINE} ${url}` and the text no longer contains `You asked us to` or `Reply to this email`; keep the no-em-dash test and extend it to the three new page copies.

### 4. Pure unsubscribe module (`src/lib/shop/unsubscribe.ts`)

Imports only `node:crypto`, the `SupabaseClient` type and `SITE_URL`, so it runs in the node pool.

- `newUnsubscribeToken(): string` → `randomBytes(32).toString("hex")` (same shape as the SQL default: 64 lowercase hex chars).
- `isUnsubscribeToken(value: unknown): value is string` → `typeof value === "string" && /^[0-9a-f]{64}$/.test(value)`. `searchParams.token` may be `string | string[] | undefined`; arrays, empty and wrong-shape values are all "invalid" with no DB call.
- `unsubscribeUrl(token)` → `${SITE_URL}/shop/wishlist/unsubscribe?token=${token}` (single place the URL shape lives; `resend.ts` uses it).
- `type UnsubscribeOutcome = "unsubscribed" | "already" | "invalid"`.
- `resolveUnsubscribe(supabase, token: unknown): Promise<UnsubscribeOutcome>`:
  1. `!isUnsubscribeToken(token)` → `"invalid"`.
  2. `select("marketing_opt_in, unsubscribed_at").eq("unsubscribe_token", token).maybeSingle()`; on error throw `new Error(\`shop_wishlist_contacts lookup failed: ${error.code}\`)` (code only; never the token or message that might echo filters).
  3. No row → `"invalid"`. `unsubscribed_at` set (or `marketing_opt_in` false) → `"already"`, no write.
  4. `update({ marketing_opt_in: false, unsubscribed_at: new Date().toISOString() }).eq("unsubscribe_token", token).is("unsubscribed_at", null).select("email")`; error → throw with code only; zero rows returned (a concurrent click won) → `"already"`; otherwise `"unsubscribed"`.
     The issue suggests selecting `email` in step 2; it is not needed for the decision, so select only what is used, and never log it.
- `unsubscribeResultPath(outcome: "unsubscribed" | "already")` → `/shop/wishlist/unsubscribe/done` | `/shop/wishlist/unsubscribe/already`.
- `scrubUnsubscribeToken<T>(event: T): T` for Sentry `beforeSend` / `beforeSendTransaction` (and `beforeBreadcrumb` if cheap): replace any `token=<value>` in strings that contain `/shop/wishlist/unsubscribe` with `token=[redacted]`, covering `event.request.url`, `event.request.query_string`, `event.transaction`, and span/contexts `data` values for `url.full`, `url.query`, `http.target`, `http.url`, `http.query`. Keep it a small, typed walk over those known fields, not a deep generic recursion.

### 5. Unit tests for the module (`src/lib/shop/__tests__/unsubscribe.unit.test.ts`)

Use a tiny in-memory fake Supabase client (one row, supports the exact chain used: `from().select().eq().maybeSingle()` and `from().update().eq().is().select()`), with `vi.fn` spies on `update`/`is` so the filter is observable.

- subscribed token → `"unsubscribed"`, `update` called once with `marketing_opt_in: false` and an ISO `unsubscribed_at`, and `.is("unsubscribed_at", null)` applied.
- already-unsubscribed token → `"already"`, `update` never called.
- unknown well-formed token → `"invalid"`; `undefined`, `""`, `["a","b"]`, `"xyz"`, 63-char hex, uppercase hex → `"invalid"` with `from` never called.
- same token twice on one fake row → `"unsubscribed"` then `"already"`.
- update returns zero rows (simulated race) → `"already"`.
- lookup error → throws, and the thrown message does not contain the token.
- `newUnsubscribeToken()` matches `isUnsubscribeToken` and two calls differ.
- `scrubUnsubscribeToken`: an event whose `request.url` is `https://issebya.com/shop/wishlist/unsubscribe?token=<64hex>` and a transaction with `data["url.query"] = "token=<64hex>"` come back with no occurrence of the token; an unrelated URL (e.g. `/booking/confirmation?session=abc`) is untouched.
- **Rotation / old-link test** (the negative case the issue requires): simulate a contact through the fake store: subscribe (token A) → `resolveUnsubscribe(A)` = `"unsubscribed"` → run the action's re-consent payload builder (step 6) against the stored row, which writes token B → `resolveUnsubscribe(A)` = `"invalid"`, `resolveUnsubscribe(B)` = `"unsubscribed"`. To make this testable without the action's Sentry/Next wiring, export the payload builder from a node-safe module (see step 6). Temporarily remove the rotation from the builder, confirm this test fails, restore it, and note that in the PR.

### 6. Server Action (`src/app/(main)/shop/[slug]/actions.ts`)

- Put the payload decision in a pure, exported helper in `src/lib/shop/wishlist.ts` (a `"use server"` file may only export async functions):
  ```ts
  export function wishlistContactUpsert(
    email: string,
    existing: { unsubscribed_at: string | null; unsubscribe_token: string } | null,
    now: string,
    newToken: () => string,
  ): { payload: Record<string, unknown>; reconsented: boolean };
  ```
  - no row → `{ email, marketing_opt_in: true, opted_in_at: now, opt_in_copy: WISHLIST_OPT_IN_COPY, source: "shop_wishlist" }` (token from the DB default), `reconsented: false`.
  - row with `unsubscribed_at` set → same plus `unsubscribed_at: null, unsubscribe_token: newToken()`, `reconsented: true`.
  - subscribed row → same as no-row payload with no token and no `unsubscribed_at` key, so the stored token is kept, `reconsented: false`.
    Pass `newToken` (i.e. `newUnsubscribeToken`) in so `wishlist.ts` stays free of `node:crypto` if preferred; otherwise import it from `unsubscribe.ts`. Either way it runs in the node pool.
- In the action, inside the existing span, before the upsert: `select("unsubscribed_at, unsubscribe_token").eq("email", parsed.data.email).maybeSingle()`; on error `captureException(error, { tags: { "db.operation": "shop_wishlist_contacts_select" } })` and return `failure`.
- Upsert the built payload with `{ onConflict: "email" }` and chain `.select("marketing_opt_in, unsubscribe_token").single()` so the post-upsert token (default, kept, or rotated) and opt-in state come back in the same round trip. Existing error handling unchanged.
- Item insert unchanged (`created = itemError === null`).
- `shouldEmail = contact.marketing_opt_in && (created || reconsented)`.
- `sendWishlistConfirmationEmail({ email, productName, productSlug, unsubscribeToken: contact.unsubscribe_token })` inside the existing try/catch + `captureException(… "email.type": "wishlist_confirmation")`. Never log or tag the token.
- `WishlistFormState` shape unchanged. Keep `created` meaning exactly "this submit inserted a new item" so the panel copy is unchanged (the issue says panel copy is unchanged; a re-consent on an already-wished item sends an email but the panel does not show the "sent a note" line; mention in Notes).
- The action never writes `marketing_opt_in: false`.

### 7. Action unit tests (`[slug]/__tests__/actions.unit.test.ts`)

- Extend the Supabase mock: `shop_wishlist_contacts` returns `{ select → eq → maybeSingle }` for the pre-read (default: `{ data: null, error: null }`) and `upsert → select → single` (default `{ data: { marketing_opt_in: true, unsubscribe_token: STORED }, error: null }`). Keep existing tests' intent; update their mock plumbing only.
- New tests:
  - re-consent: pre-read returns `{ unsubscribed_at: "2026-09-20T…", unsubscribe_token: OLD }` → upsert payload has `marketing_opt_in: true`, `unsubscribed_at: null`, an `opted_in_at` ISO string, and an `unsubscribe_token` matching `/^[0-9a-f]{64}$/` and `!== OLD`.
  - re-consent on an already-wished product (insert returns `23505`) → email sent once, with the token the upsert returned.
  - subscribed existing row → upsert payload has no `unsubscribe_token` and no `unsubscribed_at` key.
  - new item → email once with `unsubscribeToken` from the upsert result.
  - already wished, subscribed → no email (existing test kept).
  - email throws → `ok: true` and `captureException` called (existing test kept).
  - pre-read error → `failure`, no upsert.
- Add unit tests for `wishlistContactUpsert` in `wishlist.unit.test.ts` (the three branches).

### 8. Resend sender (`src/lib/resend.ts`)

- Signature `sendWishlistConfirmationEmail({ email, productName, productSlug, unsubscribeToken })`.
- `const url = unsubscribeUrl(unsubscribeToken)`; `text: wishlistConfirmationEmailText({ productName, productUrl, unsubscribeUrl: url })`; `headers: { "List-Unsubscribe": \`<${url}>\` }`. No `List-Unsubscribe-Post`. `replyTo` unchanged.
- The thrown error on Resend failure keeps its current message (no token in it).
- `resend.unit.test.ts`: pass `unsubscribeToken: "a".repeat(64)`; assert `headers["List-Unsubscribe"] === "<https://issebya.com/shop/wishlist/unsubscribe?token=aaa…>"`, `text` contains `/shop/wishlist/unsubscribe?token=aaa…`, and `headers` has no `List-Unsubscribe-Post` key.

### 9. Unsubscribe route

- `src/app/(main)/shop/wishlist/unsubscribe/page.tsx`:
  - `export const metadata: Metadata = { title: "Unsubscribe – Issebya Homes", robots: { index: false, follow: false } }` (en dash, as other titles).
  - `export default async function Page({ searchParams }: PageProps<"/shop/wishlist/unsubscribe">)`: `const { token } = await searchParams;` → `const outcome = await resolveUnsubscribe(createAdminClient(), token);` → `if (outcome === "invalid") notFound();` → `redirect(unsubscribeResultPath(outcome));`.
  - No `<Suspense>`, no `loading.tsx` in this segment or its parents on the path (the `(main)` layout has none), so both `redirect()` and `notFound()` fire before streaming: real redirect status and real 404. `redirect()` from a Server Component is a 307; for a GET that has the same effect as the 303 the issue mentions (method preserved as GET, `Location` token-free). Verify with `curl -sI` (see Validation); if it comes back 200 with a meta refresh, streaming started early and the page must be restructured before merging.
  - Model it on `booking/confirmation/page.tsx`, which already awaits `searchParams` and calls `notFound()` at the top under `cacheComponents: true`. If the build raises "Uncached data was accessed outside of <Suspense>", follow the caching doc's remedy that keeps the check outside Suspense (e.g. `await connection()` first) rather than wrapping the page in Suspense, which would downgrade the statuses.
  - Do not render anything that includes the token; the page never returns JSX in practice. Do not `console.log` anything. On a thrown lookup/update error, let Next's error boundary handle it; the Sentry scrubber (step 11) removes the token from the captured request.
- `src/app/(main)/shop/wishlist/unsubscribe/not-found.tsx`: renders `<UnsubscribeMessage copy={WISHLIST_UNSUBSCRIBE_INVALID_COPY} />`. Exports no metadata (not-found files cannot); Next injects `noindex` for 404s.
- `done/page.tsx` and `already/page.tsx`: static Server Components, `metadata` with `robots: { index: false, follow: false }`, render `<UnsubscribeMessage copy={…} />`. They read no params, so they prerender.
- `ui/UnsubscribeMessage.tsx`: `{ copy: string }` → a padded block in the shop's house style (same container/padding as the shop pages, plain `<p>`, a `Link` "Back to the shop" to `/shop`). No bold, no em dashes, no emojis. The three pages differ only in `copy` (data, not structure).
- Confirm no product slug in `src/lib/shop/products.ts` is `wishlist` (static `wishlist` segment outranks `[slug]`, which is fine, but a product with that slug would become unreachable). Confirm `sitemap.ts` lists only registry slugs, so the new routes are not in the sitemap.

### 10. Button (`WishlistDialog.tsx` + `globals.css`)

- `globals.css`: add
  ```css
  .button-outline {
    @apply px-4 py-2 border border-foreground bg-background text-foreground font-sans text-sm capitalize tracking-wide hover:bg-foreground hover:text-background transition-colors;
  }
  ```
  and change `.booking-close-button` to `@apply flex-1 button-outline;` if Tailwind v4 in this repo allows applying a custom class; if it does not, make `.booking-close-button { @apply flex-1; }` and add `button-outline` alongside `booking-close-button` in `BookingEngineExpanded.tsx`. Either way the booking Close button must render identically (check computed styles or a screenshot).
- Trigger markup:
  ```tsx
  <button
    ref={heartRef}
    type="button"
    onClick={handleOpen}
    aria-pressed={added ? true : undefined}
    aria-haspopup="dialog"
    className="button-outline inline-flex items-center gap-2 min-h-11 cursor-pointer"
  >
    <HeartIcon filled={added} className="w-5 h-5" />
    {added ? "Added to wishlist" : "Add to wishlist"}
  </button>
  ```
  No `aria-label`, no `booking-*` class, no `flex-1`. `HeartIcon` untouched (`currentColor` so it inverts on hover). Rename `heartRef` to `triggerRef` only if it reads better; not required. Put the two label strings in `wishlist.ts` as `WISHLIST_ADD_LABEL` / `WISHLIST_ADDED_LABEL` so tests and e2e import them.
- `page.tsx`: if the price row overflows on a 375px viewport, add `flex-wrap` to its `flex items-center gap-3` container. No other change; `/shop/[slug]` stays prerendered. `ProductCard` untouched.

### 11. Sentry scrubber wiring

- `sentry.server.config.ts`: add `beforeSend: (event) => scrubUnsubscribeToken(event)` and `beforeSendTransaction: (event) => scrubUnsubscribeToken(event)`. With `tracesSampleRate: 1` and `sendDefaultPii: true`, every unsubscribe request otherwise ships its full URL (token included) to Sentry as transaction data. Mirror in `sentry.edge.config.ts` only if it is a one-line import there too.
- Keep this minimal; it only touches strings containing `/shop/wishlist/unsubscribe`.

### 12. Browser tests (`WishlistDialog.browser.test.tsx`)

- `renderDialog`: query the trigger with `getByRole("button", { name: /^Add(ed)? to wishlist$/ })` (unchanged regex); replace `toHaveAttribute("aria-label", …)` assertions with `not.toHaveAttribute("aria-label")` plus an accessible-name/text check (`toHaveAccessibleName("Add to wishlist")` / `toHaveTextContent`).
- Initial: name `Add to wishlist`, `aria-pressed` absent, `[data-filled="false"]` inside the trigger.
- After a mocked successful `addToWishlist`: name `Added to wishlist`, `aria-pressed="true"`, `[data-filled="true"]` inside the trigger.
- Keep all #143 open/close/Escape/backdrop/focus-return/prefill tests passing.
- **Negative check:** temporarily hard-code the label to `Add to wishlist`, confirm the `Added to wishlist` name test fails, restore, note in the PR.

### 13. Playwright spec (`e2e/shop.integration.spec.ts`)

Modelled on `booking-flow.integration.spec.ts`; `baseURL` already configured; data seeded/cleaned with `createAdminClient()`; the server runs with `E2E_MOCK_RESEND=true`.

- Update the existing wishlist steps to import `WISHLIST_ADD_LABEL`/`WISHLIST_ADDED_LABEL` and click the button by name (they already use `getByRole("button", { name: "Add to wishlist" })`, which keeps working now that the name is visible text).
- New test in `Wishlist`: `GET /shop/wishlist/unsubscribe?token=nonsense` → `res.status()` is 404 and the page shows `WISHLIST_UNSUBSCRIBE_INVALID_COPY`.
- New test in `Wishlist` (round trip through the DB): save a wish via the UI (as the existing test does), read the contact's `unsubscribe_token` with the admin client, `page.goto(`/shop/wishlist/unsubscribe?token=${token}`)` → final URL is `/shop/wishlist/unsubscribe/done` (no `token` in `page.url()`), page shows `WISHLIST_UNSUBSCRIBED_COPY`; the DB row has `marketing_opt_in = false`, `unsubscribed_at` not null; the item row still exists. Visit the same link again → `/already` and `WISHLIST_ALREADY_UNSUBSCRIBED_COPY`. Then re-add the product with the checkbox ticked → token in DB differs from the old one, `marketing_opt_in = true`, `unsubscribed_at` null; old link → 404. Cleanup is the existing `afterEach` delete by email.
- Extend "anon cannot read either wishlist table" only if needed; it already covers the contacts table.

### 14. Docs

- `apps/website/README.md`: in the shop/wishlist section, describe the two consent states, the unsubscribe URL, token rotation on re-consent, and that nothing is deleted on unsubscribe. Add nothing to `AGENTS.md`.
- `docs/conditional-docs.md`: add an entry for `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md` (conditions: changing the wishlist unsubscribe route, token, consent-state CHECK, or the confirmation email's footer/headers; building any send to wishlist contacts). The document phase writes the doc itself.

### 15. Run the Validation Commands

Run every command below and fix anything that fails.

## Testing Strategy

### Unit Tests

- `src/lib/shop/__tests__/unsubscribe.unit.test.ts` (new): resolver outcomes, race-safe update filter, idempotency, malformed tokens never hit the DB, errors never carry the token, token generator shape, Sentry scrubber, and the rotation/old-link scenario.
- `src/lib/shop/__tests__/wishlist.unit.test.ts`: email text ends with the unsubscribe line + URL and has no "You asked us to"/"Reply to this email"; `wishlistContactUpsert` branches; no em dash in new copy.
- `src/lib/__tests__/resend.unit.test.ts`: `List-Unsubscribe` header, URL in `text`, no `List-Unsubscribe-Post`, `replyTo` kept.
- `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts`: re-consent payload and rotation, email on re-consent of an already-wished item, no rotation for subscribed contacts, email once for a new item, none for a repeat, non-fatal send failure, pre-read failure.

### Test Coverage

- `src/lib/shop/__tests__/unsubscribe.unit.test.ts` - catches an unsubscribe that double-writes, writes for an already-unsubscribed contact, hits the DB for garbage tokens, leaks the token into errors/Sentry, and (negative-tested) an old email link that can still unsubscribe a renewed consent. Nothing covers any of this today; the module does not exist.
- `src/app/(main)/shop/[slug]/__tests__/actions.unit.test.ts` (extended) - catches a re-consent that forgets to clear `unsubscribed_at` / rotate the token (which the new CHECK would also reject at runtime), a subscribed contact's token being rotated (killing links in emails they already have), and a re-consent that sends no email.
- `src/lib/shop/__tests__/wishlist.unit.test.ts` + `src/lib/__tests__/resend.unit.test.ts` (extended) - catch the email still promising "reply to stop", or shipping without the working link / `List-Unsubscribe` header.
- `src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` (extended) - catches the trigger losing its visible label, falling back to `aria-label`, or not switching to `Added to wishlist` (negative-tested).
- `apps/website/e2e/shop.integration.spec.ts` (extended) - the only layer that proves the real route: a real 404 status for a bad token, a token-free final URL after redirect, the DB state flip without item deletion, and the old link dying after re-consent against the real migration.
- No test for the CSS extraction of `.button-outline`: a pure style refactor; the booking Close button is checked visually and the wishlist button's classes are exercised by the browser test render.
- No automated migration test beyond the e2e round trip: the CHECK is proven by the four manual inserts recorded in the PR and by the migrations CI dry-run.

### Edge Cases

- Token missing, empty, repeated (`?token=a&token=b` → array), wrong length, uppercase, non-hex → 404, no DB call.
- Well-formed but unknown token (including an old token after rotation) → 404.
- Two concurrent clicks: second update matches zero rows because of `is("unsubscribed_at", null)` → "already", single write.
- Link-scanning mail client prefetches the GET → the guest is unsubscribed (accepted by the owner, documented in PR).
- Unsubscribed contact adds a new product → re-consent + rotation + one email with the new link.
- Unsubscribed contact re-adds an already-wished product → re-consent + rotation + one email (item insert is `23505`).
- Subscribed contact adds a second product → token unchanged, one email; earlier emails' links still work.
- Subscribed contact repeats an already-wished product → no email, no rotation.
- Email send fails after a re-consent → `ok: true`, captured; DB already re-consented.
- Existing prod rows at migration time → each gets a distinct token, remain subscribed, satisfy the new CHECK.
- Narrow viewports: the wider labelled button must not overflow the price row.

## Acceptance Criteria

- The trigger on `/shop/[slug]` is a `<button type="button">` with visible heart + `Add to wishlist`, no `aria-label`, `aria-pressed` unset, `aria-haspopup="dialog"`, min height 44px, outline style from `.button-outline`; after a save it shows `Added to wishlist`, a filled heart and `aria-pressed="true"`; focus returns to it on dialog close; state resets on reload. No `booking-*` class on the shop page. `ProductCard` unchanged; `/shop/[slug]` still prerendered; the booking Close button looks unchanged.
- New migration sorts after `20260925120000_…`, adds `unsubscribe_token` (unique, not null, random default) and `unsubscribed_at`, replaces the consent CHECK with `shop_wishlist_contacts_consent_state`; RLS/zero policies/revokes intact; header comment accurate. Applied locally with `migration up`; distinct-token count equals row count; the four inserts behave as specified; migrations CI dry-run green.
- `GET /shop/wishlist/unsubscribe?token=<valid subscribed>` flips `marketing_opt_in` to false and sets `unsubscribed_at`, deletes nothing, and redirects (HTTP 3xx) to a token-free URL showing `You're unsubscribed. We won't email you about the wishlist any more.`; repeating it shows `You're already unsubscribed.` with no write; unknown/missing/malformed token answers HTTP 404 with `This link isn't valid.`; all these pages are `noindex`; the unsubscribe page is dynamic.
- The token appears in no rendered HTML, no log line, no Sentry tag/transaction URL (scrubbed), and no PostHog event (the token URL never renders).
- The email ends with `If you'd rather not receive these emails, unsubscribe here: <url>`, no longer contains `You asked us to` or `Reply to this email to stop these.`, carries `List-Unsubscribe: <url>` and no `List-Unsubscribe-Post`, keeps `replyTo`.
- `addToWishlist`: re-consent sets `marketing_opt_in = true, unsubscribed_at = null, opted_in_at = now, opt_in_copy` and rotates the token; subscribed contacts keep their token; email sent iff opted in after the write and (`created` or re-consented); `WishlistFormState` and panel copy unchanged; never lowers `marketing_opt_in`.
- Negative checks performed and reverted: rotation removed → old-link test fails; label swap removed → `Added to wishlist` browser test fails.
- All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `cd apps/website && yarn supabase migration up` - Applies the new migration to the shared local instance (never `db reset`)
- `cd apps/website && psql "$(yarn -s supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')" -c "select count(*), count(distinct unsubscribe_token), count(*) filter (where marketing_opt_in and unsubscribed_at is null) from public.shop_wishlist_contacts;"` - All three counts equal: every existing contact got its own token and is still subscribed
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced (`WISHLIST_EMAIL_STOP_LINE` fully removed; every new export used)
- `yarn turbo run test --filter=./apps/website` - Unit + chromium browser tests pass
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; in the route table `/shop/[slug]` is still prerendered (SSG), `/shop/wishlist/unsubscribe` is dynamic, `/done` and `/already` are static
- With the run's dev server up on its own port (`$PORT`, never assume 3000): `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/shop/wishlist/unsubscribe?token=nonsense"` prints `404`, and `curl -sI "http://localhost:$PORT/shop/wishlist/unsubscribe?token=$(printf 'f%.0s' {1..64})"` shows `404` (well-formed unknown token); for a real subscribed token read from the local DB, `curl -sI` shows a `3xx` status with `location: /shop/wishlist/unsubscribe/done` and no `token` in it
- `curl -s "http://localhost:$PORT/shop/wishlist/unsubscribe/done" | grep -c 'noindex'` - Result page is noindex (≥1)

## Notes

- **No new dependencies.** `node:crypto` is built in; `resend@4.8.0` already types `headers?: Record<string, string>`.
- **Redirect status.** Next's `redirect()` from a Server Component answers 307 (303 is only for Server Actions). For a GET link both keep the method as GET and carry a token-free `Location`, which is what the issue's 303 requirement is protecting. If a true 303 is later required, the only way is a Route Handler, which cannot render the segment `not-found.tsx`; not worth it here.
- **Real status codes depend on no streaming before the check.** The page must not gain a `<Suspense>`/`loading.tsx` above the resolver call, or `notFound()` degrades to a 200 soft-404 and `redirect()` to a client-side meta refresh that renders the token URL (and fires a PostHog pageview with it). The curl checks above guard this; worth a comment in the page.
- **Prefetching mail clients** that follow links will unsubscribe the guest; the owner accepts this. State it in the PR. No confirmation step.
- **Panel vs email on re-consent.** When a previously unsubscribed guest re-wishes an already-wished product, a new email goes out but `created` is false, so the panel does not show "We've sent a note to …". This follows the issue's "WishlistFormState shape and panel copy are unchanged". A future tweak could return `created || reconsented` as the panel flag.
- **Sentry.** `tracesSampleRate: 1` + `sendDefaultPii: true` would otherwise record the full unsubscribe URL on every request; the scrubber closes that. Vercel's own request logs still see the URL, like any query-string token (bookings' `access_token` has the same property).
- **Manual on the PR preview** (for the PR description, not the pipeline): add a product → paste subject and last two lines with address and token redacted → click link → unsubscribed copy, no token in address bar → click again → already copy → re-add with checkbox ticked → new email → old link 404, new link works → Studio shows the item row still present.
- Out of scope: preference centre, per-topic consent, double opt-in, marketing sends, persisting heart state, `List-Unsubscribe-Post`.
