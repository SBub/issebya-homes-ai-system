# Feature: Shop wishlist trigger as a bordered "SAVE TO WISHLIST" button

## Metadata

issue_number: `150`
adw_id: `091cac99`
issue_json: `{"number":150,"title":"Shop wishlist: trigger is a bordered 'SAVE TO WISHLIST' button with the heart before the text (supersedes the wording in #147)"}`

## Feature Description

On `/shop/[slug]` the wishlist trigger next to the price is a bare 24 px heart icon whose only name is an `aria-label` ("Add to wishlist" / "Added to wishlist"). The owner has specified the exact look: a bordered, uppercase, widely letter-spaced button in a muted foreground, with the heart icon **before** the visible label **Save to wishlist**, which reads **Saved to wishlist** (with a filled heart) after a successful save. The house label typography (`uppercase tracking-[0.2em] text-xs`) and the house bordered-button pattern (`.booking-close-button`: border in the foreground colour, hover inverts emphasis) are combined on the single trigger button. Behaviour is unchanged: the same `<dialog>`, form, confirmation panel, email and non-persisted state.

This supersedes the wording in #147. As of this worktree (`f7e0747`), #147 has not landed: the trigger still carries `aria-label={added ? "Added to wishlist" : "Add to wishlist"}`. The change below applies to whatever trigger markup is present; if #147 lands first, replace its label/aria-label the same way.

## User Story

As a shop visitor looking at a product page
I want a clearly labelled "Save to wishlist" button next to the price, showing a heart that fills once saved
So that I understand what the control does, and can see at a glance that my save worked

## Problem Statement

A bare heart icon is ambiguous (like? favourite? share?) and visually out of step with the rest of the page, whose controls are labelled uppercase text. Its accessible name lives only in an `aria-label`, so sighted users and screen-reader users get different information.

## Solution Statement

Restyle the existing trigger `<button>` in `WishlistDialog.tsx` in place, inline Tailwind on the one button (no new component, no new CSS class, no dependency):

- Content: `<HeartIcon filled={added} className="w-4 h-4 shrink-0" />` first, then a text node `{added ? "Saved to wishlist" : "Save to wishlist"}` typed in sentence case; CSS `uppercase` renders the caps, so assistive tech reads the sentence.
- Drop the `aria-label` (the visible text is the accessible name). Keep `ref`, `type="button"`, `onClick={handleOpen}`, `aria-pressed={added ? true : undefined}` and `aria-haspopup="dialog"` exactly as they are.
- Classes: `inline-flex items-center gap-2 min-h-11 px-5 py-3 border border-foreground/60 text-foreground/70 uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-foreground hover:text-foreground`.
  - `min-h-11` is required: `py-3` (24 px) + the `text-xs` line height (16 px) + 2 px of border is 42 px, under the 44 px hit-area contract.
  - 16 px icon (`w-4 h-4`) matches `text-xs`; the SVG's `width`/`height` attributes are overridden by the classes, as they already are for `w-6 h-6`.
  - `border-foreground/60` and `text-foreground/70` work because `--color-foreground` is a theme colour in `globals.css` (`@theme inline`), so Tailwind v4 generates the opacity modifiers via `color-mix`.
- Placement: `page.tsx` keeps `<div className="flex items-center gap-3">` with price then trigger. Add `flex-wrap` to that div so on a narrow screen the button wraps under the price instead of squeezing it (the issue asks for this explicitly; `gap-3` then also spaces the wrapped row).

Name collision to handle in tests: the dialog's submit button is also named "Save to wishlist" (`WishlistFields`), and the form only mounts while the dialog is open. Before open and after close the trigger is the only "Save to wishlist" button; while the dialog is open, both exist. Test queries must therefore scope the submit to the dialog, and locate the trigger in a way that does not also match the submit (see tasks). "Saved to wishlist" does not collide (no other element carries it; the dialog heading is "Save to your wishlist", a heading not a button).

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook gates, never reset the shared DB).
- `apps/website/AGENTS.md` - website rules, and which test layers gate (`*.browser.test.tsx` gates on push/CI; `e2e/` runs only in the ADW test phase).
- `docs/conditional-docs.md` - index; the matching entry is `apps/website/app_docs/component-patterns-guide.md` (changing a component) and the two wishlist feature docs below.
- `apps/website/app_docs/component-patterns-guide.md` - component conventions; confirms no new shared component is warranted for one button.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - the trigger `<button>` (the `heartRef` button) to restyle and relabel. Only the trigger changes; the dialog, form and panel stay as they are.
- `apps/website/src/app/(main)/shop/[slug]/ui/HeartIcon.tsx` - existing inline SVG with `filled` prop and `data-filled` attribute; reused unchanged at `w-4 h-4`.
- `apps/website/src/app/(main)/shop/[slug]/page.tsx` - the price row (`flex items-center gap-3`) that hosts the trigger; gains `flex-wrap`.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` - browser tests that locate the trigger by `/^Add(ed)? to wishlist$/` and assert on `aria-label`; must move to the visible-text names.
- `apps/website/e2e/shop.integration.spec.ts` - Playwright wishlist steps that click `"Add to wishlist"` / assert `"Added to wishlist"`; must move to the new names.
- `apps/website/src/app/globals.css` - reference only: `.booking-close-button` (the bordered pattern being echoed) and the `--color-foreground` theme token. Not edited.
- `apps/website/src/lib/shop/wishlist.ts` - reference only: `WISHLIST_DIALOG_HEADING` ("Save to your wishlist") and other copy, to confirm no accessible-name collision beyond the submit button.
- `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md` - documents the trigger as a "heart icon button"; update its description of the trigger.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md` - older doc that tells readers to press "Add to wishlist"; update the wording.

### New Files

None.

## Implementation Plan

### Phase 1: Foundation

Nothing to build first: `HeartIcon`, the house typography and the foreground theme token already exist. Confirm the current trigger markup (post-#147 or not) before editing.

### Phase 2: Core Implementation

Restyle and relabel the trigger button in `WishlistDialog.tsx`; add `flex-wrap` to the price row in `page.tsx`.

### Phase 3: Integration

Update the browser test and the Playwright spec to the visible-text names (handling the submit-button name collision), prove the browser test fails without the label change, update the two wishlist feature docs, then run the gates and take screenshots at 1280 and 390 px.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing docs

- Read `apps/website/AGENTS.md` and `apps/website/app_docs/component-patterns-guide.md`.
- Re-read `WishlistDialog.tsx` in this worktree; if #147 has landed, note its trigger label/`aria-label` so step 2 replaces that instead.

### 2. Restyle the trigger in `WishlistDialog.tsx`

- On the trigger `<button>` (the one with `ref={heartRef}`):
  - Remove the `aria-label` prop.
  - Keep `ref`, `type="button"`, `onClick={handleOpen}`, `aria-pressed={added ? true : undefined}`, `aria-haspopup="dialog"` unchanged (and any `aria-expanded`/`aria-controls` if #147 added them).
  - Replace `className` with `inline-flex items-center gap-2 min-h-11 px-5 py-3 border border-foreground/60 text-foreground/70 uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-foreground hover:text-foreground`.
  - Children: `<HeartIcon filled={added} className="w-4 h-4 shrink-0" />` followed by `{added ? "Saved to wishlist" : "Save to wishlist"}`. Sentence case in source; caps come from `uppercase`.
- Optional, low-risk: rename `heartRef` to `triggerRef` and adjust the "heart" wording in the two nearby comments ("In-memory on purpose: the heart is empty again after a reload" can stay, it is still true of the icon). Do not touch anything inside `<dialog>` or `WishlistFields`.

### 3. Let the price row wrap in `page.tsx`

- Change `<div className="flex items-center gap-3">` (price + `WishlistDialog`) to `<div className="flex flex-wrap items-center gap-3">`.

### 4. Update `WishlistDialog.browser.test.tsx`

- Replace the trigger locator in `renderDialog`. The trigger precedes the `<dialog>` in DOM order, and the only other same-named button (the dialog's submit) exists only while the dialog is open, so:
  - `const trigger = screen.getByRole("button", { name: /^saved? to wishlist$/i }).first();` with a one-line comment explaining that `.first()` is the trigger because the dialog's own "Save to wishlist" submit renders after it and only while open. Rename `heart` to `trigger` throughout (test titles may keep "heart" where they describe the icon).
  - Scope every submit query to the dialog: in `saveAs` and in the "submit stays disabled…" and "reopening after a success…" tests, use `dialog().getByRole("button", { name: "Save to wishlist" })` instead of `screen.getByRole(...)` (pass `dialog` into `saveAs` or re-derive it there). Without this they become strict-mode violations while the dialog is open.
- Rewrite "the heart starts empty and unpressed" as "the trigger reads Save to wishlist, unpressed, with an empty heart":
  - `await expect.element(screen.getByRole("button", { name: /^save to wishlist$/i })).toBeVisible();` (dialog closed, so unique)
  - `not.toHaveAttribute("aria-pressed")`, `not.toHaveAttribute("aria-label")`, and the `svg[data-filled="false"]` check as today.
  - Assert the heart comes before the text: `expect(trigger.element().firstElementChild?.tagName.toLowerCase()).toBe("svg")`.
- In "a new save shows the confirmation panel…": replace the `aria-label` assertion with `await expect.element(screen.getByRole("button", { name: /^saved to wishlist$/i })).toHaveAttribute("aria-pressed", "true");` and keep the `svg[data-filled="true"]` check on it. Also assert `not.toHaveAttribute("aria-label")`.
- Keep every other test's behaviour assertions (open, Escape/Close focus return, prefill, PostHog events) unchanged, only switching to the new locator.
- Negative check: temporarily revert the label text to the old wording (and/or restore the `aria-label`), run `yarn turbo run test --filter=./apps/website`, confirm the Save/Saved tests fail on the `getByRole` name query, then restore the change and confirm green. State in the implementation report that this was tried and reverted.

### 5. Update the Playwright spec `e2e/shop.integration.spec.ts`

Modelled on the existing wishlist tests (and `booking-flow.integration.spec.ts` patterns: `baseURL` configured, fixtures cleaned via `createAdminClient()` in `afterEach`, which is already in place).

- "wishing the same product twice…":
  - First click: `page.getByRole("button", { name: "Save to wishlist", exact: true })` (dialog closed, so the form is unmounted and the name is unique). Add `await expect(trigger).not.toHaveAttribute("aria-pressed")` before clicking.
  - Submit stays scoped: `dialog.getByRole("button", { name: "Save to wishlist" })` (already scoped; add `exact: true`).
  - After success: `page.getByRole("button", { name: "Saved to wishlist", exact: true })` with `aria-pressed="true"` (rename `addedHeart` to `savedTrigger`); additionally assert `await expect(savedTrigger.locator('svg[data-filled="true"]')).toHaveCount(1)`.
  - After `page.reload()`: trigger is `"Save to wishlist"` again, unpressed (in-memory by design), then the existing already-wished flow.
- "Escape closes the dialog and returns focus to the heart": locate the trigger as `page.getByRole("button", { name: "Save to wishlist", exact: true })` before opening; after Escape, the form is unmounted so the same locator is unique again for `toBeFocused()`. Retitle to "…returns focus to the trigger".
- No new fixtures, no DB changes.

### 6. Update the wishlist feature docs

- `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md`: where it describes the trigger as a heart icon button, note that since #150 the trigger is a bordered uppercase "Save to wishlist" / "Saved to wishlist" button with the heart before the text; `aria-pressed` unchanged, no `aria-label`.
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md`: change the manual-check step "press "Add to wishlist"" to "press "Save to wishlist"".
- No `docs/conditional-docs.md` entry needed (no new document).

### 7. Visual check against the owner's reference

- Start the website dev server on this run's port (`PORT` env; never 3003/3005, never a second webhook app server), open `/shop/<first product slug>`, and take screenshots at 1280 px and 390 px widths, before and after a mocked or real save (the e2e run's local Supabase is fine; no reset). Verify: bordered box, uppercase, letter-spaced, muted text, heart left of the text, ≥44 px tall, sits next to the price at 1280 and wraps under it at 390 if it does not fit. Hover darkens border and text.

### 8. Run the validation commands

- Run every command in `Validation Commands` and fix anything they flag.

## Testing Strategy

### Unit Tests

No `*.unit.test.ts` change: there is no pure logic here, only markup, an accessible name and styling. The behaviour worth proving (accessible name, `aria-pressed`, icon state and order) needs a real DOM, so it belongs in the browser test.

### Test Coverage

- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` (`*.browser.test.tsx`, gates on push/CI): before a save, `getByRole("button", { name: /^save to wishlist$/i })` exists with no `aria-pressed`, no `aria-label`, an outline heart as its first child; after a mocked success, `getByRole("button", { name: /^saved to wishlist$/i })` has `aria-pressed="true"` and `svg[data-filled="true"]`. Catches a regression to icon-only/`aria-label` naming or wrong wording, which the current tests (asserting "Add to wishlist") would not. Fails without the change (verified by the revert in task 4).
- `apps/website/e2e/shop.integration.spec.ts` (Playwright, run by the ADW test phase on this run's port): the full wishlist journey on the real page clicks the trigger by its visible name "Save to wishlist", sees it become "Saved to wishlist" with `aria-pressed="true"` and a filled heart, and returns to "Save to wishlist" after reload; Escape returns focus to it. Catches the page-level wiring (trigger rendered next to the price, name collision with the dialog submit handled) that the component test cannot.
- Styling (border, tracking, colours, wrap) is not asserted by tests; it is verified by the screenshots in task 7. Asserting class names would only restate the source.

### Edge Cases

- Dialog open: two buttons named "Save to wishlist" (trigger + submit). Tests scope the submit to the dialog and take the trigger as `.first()` / query it while the dialog is closed.
- Accessible name vs CSS `uppercase`: source text is sentence case; queries use case-insensitive regex or the sentence-case string, so they hold whether or not the engine applies `text-transform` to the name.
- "Saved to wishlist" must not match a `/save to wishlist/` query and vice versa (the `d` breaks the substring; anchored regexes and `exact: true` make it explicit).
- Reload after save: state is in-memory, so the trigger is "Save to wishlist" and unpressed again.
- Closing the dialog by Escape, Close or backdrop still returns focus to the trigger (ref unchanged).
- Narrow viewport (390 px): the price row wraps; the button keeps its 44 px height and does not overflow.
- Dark mode (`prefers-color-scheme: dark` flips `--foreground`): the `/60` and `/70` opacities derive from the token, so contrast follows the theme.

## Acceptance Criteria

- The trigger shows a heart icon followed by the text "Save to wishlist" (rendered uppercase via CSS), and after a successful save shows a filled heart and "Saved to wishlist".
- The trigger has no `aria-label`; its accessible name is the visible text. `aria-pressed` is absent before a save and `"true"` after. `aria-haspopup="dialog"` and the `ref`/`onClick` wiring are unchanged.
- Classes include `inline-flex items-center gap-2`, `px-5 py-3`, `min-h-11`, `border border-foreground/60 text-foreground/70 tracking-[0.2em] text-xs uppercase`, and hover `border-foreground text-foreground`; icon is 16 px.
- Rendered height is ≥ 44 px; the button sits next to the price at 1280 px and wraps under it at 390 px when needed.
- Dialog, form, confirmation panel, email and PostHog events behave exactly as before.
- No new component, CSS class, dependency or icon library.
- Browser test passes, and fails when the label change is reverted (tried and reverted).
- `e2e/shop.integration.spec.ts` wishlist tests pass on the run's port.
- `yarn lint && yarn typecheck && yarn turbo run test --filter=./apps/website && yarn knip` green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/website` - Unit and browser Vitest projects pass, including the updated `WishlistDialog.browser.test.tsx`
- `yarn turbo run build --filter=./apps/website` - Production build succeeds

## Notes

- No new dependencies.
- Only `apps/website` is affected; `telegram-router`, `guest-communication-agent` and `packages/pricing` are untouched.
- Inline Tailwind on the one button was chosen over a `.wishlist-trigger` class in `globals.css`: the style has exactly one call site and lives next to the markup it styles, which is how the rest of `WishlistDialog.tsx` (dialog heading, Close, submit) is styled. `.booking-close-button` is echoed, not reused, because it carries `flex-1`, `capitalize`, `text-sm` and an inverted hover that conflict with the specified look.
- If #147 lands before this, it may add `aria-expanded`/`aria-controls` and its own "Add to wishlist" label; keep the former, replace the latter.
- Out of scope: dialog, email, unsubscribe (#147), product grid.
