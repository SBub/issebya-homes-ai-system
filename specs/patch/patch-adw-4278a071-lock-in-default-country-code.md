# Patch: Seed the lock-in guest form's country code with Portugal

## Metadata

adw_id: `4278a071`
review_change_request: `Issue #1: The lock-in guest form does not match the nightly form it is supposed to share. LockInEngineExpanded.tsx line 32 sets the initial state to values.countryId: "". No <option> has that value, so the browser selects the first one in COUNTRY_CODES, which is '+93 Afghanistan'. The nightly BookingEngineExpanded seeds countryId from splitPhoneNumber(''), which returns DEFAULT_COUNTRY_ID = 'PT'. A guest who types only their local number gets it saved as +93…: the guest_contacts row and the Stripe metadata carry the wrong phone number, and WhatsApp follow-ups go to the wrong number. Resolution: seed initialState.values.countryId with the same default the nightly engine uses (splitPhoneNumber("").countryId, or an exported DEFAULT_COUNTRY_ID), then assert in LockInClient.browser.test.tsx that the 'Country code' select shows the Portugal option after a week is picked. Severity: blocker`

## Issue Summary

**Original Spec:** `specs/issue-232-adw-4278a071-sdlc_planner-lock-in-week-booking.md`
**Issue:** `LockInEngineExpanded`'s module-level `initialState` sets `values.countryId: ""`. `BookingGuestForm` renders the `Country code` `<select>` with `defaultValue={state.values.countryId}`; no `<option>` has value `""`, so the browser falls back to the first entry of `COUNTRY_CODES` (`+93 Afghanistan`). The nightly `BookingEngineExpanded` seeds the same field from `splitPhoneNumber(initialPhone)`, which yields `"PT"` for an empty phone. A lock-in guest who types only a local number is saved, charged and messaged under `+93`.
**Solution:** Seed `initialState.values.countryId` with `splitPhoneNumber("").countryId`, the exact path the nightly engine uses, so both forms share one default without widening the `country-codes.ts` export surface (keeps `knip` clean, no second constant to drift). Add a browser-test assertion that the `Country code` select holds `PT` / shows the Portugal option once a week is picked.

## Files to Modify

Use these files to implement the patch:

- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInEngineExpanded.tsx`
- `apps/website/src/app/(main)/lock-in/[type]/ui/LockInClient.browser.test.tsx`

## Implementation Steps

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Seed the default country in `LockInEngineExpanded.tsx`

- Add `import { splitPhoneNumber } from "@/lib/shared/country-codes";` alongside the other `@/lib/...` imports (keep import ordering consistent with the file).
- In the module-level `initialState`, replace `countryId: "",` with `countryId: splitPhoneNumber("").countryId,`. Leave `localNumber: ""` and every other field unchanged; `initialState` stays `satisfies BookingFormState`.
- Optionally add a one-line comment matching the file's style, e.g. `// Same default as the nightly form (Portugal).`

### Step 2: Assert the default in `LockInClient.browser.test.tsx`

- In the existing test `"picking an available week opens the guest form with 7 nights, the week price and no tourist tax"`, after the form is visible, add:
  - `await expect.element(screen.getByLabelText("Country code")).toHaveValue("PT");`
  - and assert the visible option is Portugal, e.g. `expect((screen.getByLabelText("Country code").element() as HTMLSelectElement).selectedOptions[0]?.textContent).toMatch(/\+351 Portugal/);`
- Do not touch other tests or the `failedState` fixture.

### Step 3: Confirm the test fails without the fix (sanity check)

- Temporarily revert Step 1 locally, run the browser test file, confirm the new assertion fails (`AF` / `+93 Afghanistan`), then restore Step 1. Do not commit the revert.

## Validation

Execute every command to validate the patch is complete with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website`
- `yarn turbo run lint --filter=./apps/website`
- `yarn prettier --check .`
- `yarn knip`
- `yarn turbo run test --filter=./apps/website` (unit and chromium browser projects; includes the new `Country code` assertion in `LockInClient.browser.test.tsx`)
- `yarn turbo run build --filter=./apps/website`

## Patch Scope

**Lines of code to change:** ~5 (1 import + 1 value in the engine, 2-3 assertion lines in the test)
**Risk level:** low
**Testing required:** Browser test asserting the `Country code` select defaults to Portugal (`PT`, `+351`) after a week is picked; full website typecheck, lint, knip, unit/browser tests and build to confirm no regression in the nightly flow.
