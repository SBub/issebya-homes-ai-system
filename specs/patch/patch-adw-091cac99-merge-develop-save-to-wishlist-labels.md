# Patch: Merge develop (#147) and make the spec's "Save to wishlist" trigger win

## Metadata

adw_id: `091cac99`
review_change_request: `Issue #1: #147 (PR #148, merge commit e629921) merged into origin/develop after this branch forked from f7e0747, and it rewrote the same trigger (WISHLIST_ADD_LABEL / WISHLIST_ADDED_LABEL constants, 'button-outline inline-flex items-center gap-2 min-h-11 cursor-pointer' class, w-5 h-5 heart, new unsubscribe e2e tests whose wish() helper clicks the trigger by WISHLIST_ADD_LABEL). git merge-tree reports content conflicts in WishlistDialog.tsx, WishlistDialog.browser.test.tsx and e2e/shop.integration.spec.ts. Resolution: merge origin/develop, resolve the three conflicts so the spec's design wins, switch the label constants to "Save to wishlist" / "Saved to wishlist", keep #147's unsubscribe tests with exact: true trigger/submit queries in wish(), confirm no stale "Add to wishlist" references remain, re-run the six validation commands. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-150-adw-091cac99-sdlc_planner-wishlist-trigger-bordered-button.md`
**Issue:** #147 landed on `develop` after this branch forked. It turned the trigger into a `.button-outline` text button labelled by `WISHLIST_ADD_LABEL = "Add to wishlist"` / `WISHLIST_ADDED_LABEL = "Added to wishlist"` (in `apps/website/src/lib/shop/wishlist.ts`), with a `w-5 h-5` heart, and added two unsubscribe e2e tests. It also already added `flex-wrap` to the price row in `page.tsx` (same as this branch, merges cleanly) and `aria-label` is gone on both sides. The branch now conflicts with `develop` in three files, and the spec's "if #147 lands first, replace its label the same way" was never applied to #147's actual code.
**Solution:** Merge `origin/develop` into this branch. In the conflicts, take #147's structure (imports, constants, unsubscribe tests, `toHaveAccessibleName` checks) but this branch's design (spec className, `w-4 h-4 shrink-0` heart, `triggerRef`, `.first()` trigger locator, dialog-scoped submits). Rename the constants to `WISHLIST_SAVE_LABEL = "Save to wishlist"` / `WISHLIST_SAVED_LABEL = "Saved to wishlist"` so every stale reference fails typecheck instead of silently surviving. Leave `.button-outline` in `globals.css` (still used by the booking Close button in `BookingEngineExpanded.tsx`). Update #147's docs that still name the old label.

## Files to Modify

Use these files to implement the patch:

- `apps/website/src/lib/shop/wishlist.ts` - rename + revalue the two label constants (auto-merged from develop; edit after merge).
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.tsx` - conflict.
- `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` - conflict.
- `apps/website/e2e/shop.integration.spec.ts` - conflict.
- `apps/website/README.md` - line ~37 names the "Add to wishlist" button (from #147).
- `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md` - lines ~9 and ~48 name the old labels (from #147).
- `apps/website/app_docs/feature-972c79dc-shop-wishlist-email-optin.md` and `apps/website/app_docs/feature-bcb9a5cf-wishlist-heart-modal-email.md` - only if the `rg` check in Step 5 still finds the old literal in them after the merge.

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Merge `origin/develop`

- `git fetch origin develop && git merge origin/develop` (a merge commit, not a rebase; message `chore: merge develop into wishlist trigger branch`, no `Co-Authored-By`).
- Expect conflicts in exactly the three files above. `page.tsx` (both sides added `flex-wrap`), `globals.css`, `BookingEngineExpanded.tsx`, `wishlist.ts`, the unsubscribe code, migration and docs auto-merge; accept them as-is.
- Never run `supabase db reset` / `supabase start`: #147's migration `20260926120000_add_shop_wishlist_unsubscribe.sql` is for the ADW test phase to apply, not this step.

### Step 2: Relabel the constants in `wishlist.ts`, then resolve `WishlistDialog.tsx`

- In `apps/website/src/lib/shop/wishlist.ts`, replace
  `export const WISHLIST_ADD_LABEL = "Add to wishlist";` / `export const WISHLIST_ADDED_LABEL = "Added to wishlist";`
  with `export const WISHLIST_SAVE_LABEL = "Save to wishlist";` / `export const WISHLIST_SAVED_LABEL = "Saved to wishlist";`. Keep the comment above them ("The trigger's visible text, which is also its accessible name."); add one line noting the dialog's submit button shares the "Save to wishlist" name, so tests must scope it to the dialog.
- In `WishlistDialog.tsx`, resolve so the import list is #147's with the two names swapped to `WISHLIST_SAVE_LABEL` / `WISHLIST_SAVED_LABEL`, and the trigger is exactly:
  - `ref={triggerRef}`, `type="button"`, `onClick={handleOpen}`, `aria-pressed={added ? true : undefined}`, `aria-haspopup="dialog"`, no `aria-label` (#147 added no `aria-expanded`/`aria-controls`; if the merged file has them, keep them).
  - `className="inline-flex items-center gap-2 min-h-11 px-5 py-3 border border-foreground/60 text-foreground/70 uppercase tracking-[0.2em] text-xs cursor-pointer transition-colors hover:border-foreground hover:text-foreground"` (no `button-outline`).
  - Children: `<HeartIcon filled={added} className="w-4 h-4 shrink-0" />` then `{added ? WISHLIST_SAVED_LABEL : WISHLIST_SAVE_LABEL}`.
- Confirm no `heartRef` remains (`triggerRef` used in the declaration, `handleClose` focus and the button).
- Optionally consider whether the dialog's submit button should also use `WISHLIST_SAVE_LABEL`; do NOT change it in this patch (out of scope, the submit lives in `WishlistFields`).

### Step 3: Resolve `WishlistDialog.browser.test.tsx`

- Imports: #147's list with `WISHLIST_ADD_LABEL`/`WISHLIST_ADDED_LABEL` swapped to `WISHLIST_SAVE_LABEL`/`WISHLIST_SAVED_LABEL`.
- Take this branch's side for `renderDialog` (trigger via `getByRole("button", { name: /^saved? to wishlist$/i }).first()` with its explanatory comment, returned as `trigger`), `saveAs` and every submit query scoped to `dialog()` (never `screen.getByRole("button", { name: "Save to wishlist" })`).
- "Starts" test: keep this branch's title and assertions (unique `/^save to wishlist$/i` query while closed, no `aria-pressed`, no `aria-label`, `svg` first child, `data-filled="false"`), and fold in #147's `toHaveAccessibleName(WISHLIST_SAVE_LABEL)` and `toHaveTextContent(WISHLIST_SAVE_LABEL)` on `trigger`.
- "A new save…" test: keep this branch's assertions, plus `toHaveAccessibleName(WISHLIST_SAVED_LABEL)` / `toHaveTextContent(WISHLIST_SAVED_LABEL)` on `trigger`, `aria-pressed="true"`, no `aria-label`, `data-filled="true"`.
- Every reference is `trigger`, not `heart` (a leftover `heart` from #147's side is a type error, which typecheck will catch).

### Step 4: Resolve `e2e/shop.integration.spec.ts`

- Imports: #147's list (keep `WISHLIST_ALREADY_UNSUBSCRIBED_COPY`, `WISHLIST_UNSUBSCRIBE_INVALID_COPY`, `WISHLIST_UNSUBSCRIBED_COPY`), with the label constants swapped to `WISHLIST_SAVE_LABEL`/`WISHLIST_SAVED_LABEL`.
- "wishing the same product twice…" and "Escape closes the dialog and returns focus to the trigger": take this branch's versions, replacing the string literals with the constants (`{ name: WISHLIST_SAVE_LABEL, exact: true }`, `{ name: WISHLIST_SAVED_LABEL, exact: true }`); keep `savedTrigger`, the `data-filled="true"` check and the dialog-scoped `exact: true` submit.
- Keep #147's "a malformed unsubscribe link lands on a token-free 404" unchanged.
- Keep #147's "the unsubscribe link opts out, keeps the wish, and dies on re-consent", but in its `wish()` helper:
  - trigger: `page.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click()` (dialog closed, so unique; on the second `wish()` call the page was re-navigated, so the trigger is unpressed "Save to wishlist" again);
  - submit: `dialog.getByRole("button", { name: WISHLIST_SAVE_LABEL, exact: true }).click()`.

### Step 5: Clear stale references and update #147's docs

- Run `rg -n "Add to wishlist|Added to wishlist|WISHLIST_ADD" apps/website`. Expected remaining hits are docs only; fix each:
  - `apps/website/README.md` (~line 37): `The "Add to wishlist" button` → `The "Save to wishlist" button`.
  - `apps/website/app_docs/feature-3b203d9a-wishlist-button-unsubscribe.md`: line ~9 keep the history but reword to avoid the old literal, e.g. "becomes a labelled outline button (relabelled "Save to wishlist" / "Saved to wishlist" with the bordered uppercase style by #150)"; line ~48 manual check → click "Save to wishlist" … reads "Saved to wishlist". Where it lists `WishlistDialog.tsx` using `.button-outline`, note that since #150 the trigger uses inline Tailwind and `.button-outline` is used only by the booking Close button.
  - `feature-972c79dc-…` / `feature-bcb9a5cf-…`: any remaining historical mention of the old text-button label, reword to "the original text wishlist button" so the grep is clean.
- Re-run the `rg` command; it must print nothing. Also `rg -n "heartRef|button-outline" "apps/website/src/app/(main)/shop"` must print nothing.
- Commit the resolution: `fix(website): resolve #147 merge so the wishlist trigger reads Save to wishlist` (conventional commit, no `Co-Authored-By`).

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `git merge-tree --write-tree HEAD origin/develop` - exits 0 with no `CONFLICT` lines (branch now contains develop).
- `rg -n "Add to wishlist|Added to wishlist|WISHLIST_ADD" apps/website` - no output.
- `yarn prettier --check . && yarn turbo run lint --filter=./apps/website && yarn turbo run typecheck --filter=./apps/website` - formatting, lint and types pass.
- `yarn knip` - no unused exports (the renamed constants are all used; `.button-outline` is CSS, not tracked).
- `yarn turbo run test --filter=./apps/website && yarn turbo run build --filter=./apps/website` - unit + browser tests (including `WishlistDialog.browser.test.tsx` and #147's `unsubscribe`/`wishlist`/`resend` unit tests) pass, and the production build succeeds.

## Patch Scope

**Lines of code to change:** ~40 in conflict resolution and constants, ~10 in docs (the merge itself brings in #147's ~1300 lines unchanged)
**Risk level:** medium (a merge across a whole feature; mitigated by typecheck catching any leftover old constant or `heart` name)
**Testing required:** the spec's six validation commands; the Playwright wishlist + unsubscribe tests in `e2e/shop.integration.spec.ts` run in the ADW test phase on this run's port
