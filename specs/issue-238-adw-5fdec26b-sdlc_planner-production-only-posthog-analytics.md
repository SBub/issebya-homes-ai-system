# Feature: Production-only PostHog, internal/automated tagging, lock-in waitlist events

## Metadata

issue_number: `238`
adw_id: `5fdec26b`
issue_json: `{"number":238,"title":"Analytics: production-only PostHog, internal/automated tagging, lock-in waitlist events"}`

## Feature Description

PostHog on `apps/website` must measure the lock-in experiment correctly. Today it initialises whenever `NODE_ENV === "production"`, which is also true on every Vercel preview, so previews and ADW deploys would pollute the data the moment the variables are set. The owner's own visits and automated browsers (Playwright e2e, ADW review) are not distinguishable from real visitors. And the conversion the experiment exists for, joining the lock-in waitlist, sends no PostHog event at all.

This feature:

1. Gates PostHog init on the production Vercel deploy (`NEXT_PUBLIC_VERCEL_ENV === "production"`) plus both PostHog variables, skipping silently otherwise.
2. Ports adw-dashboard's internal-device tagging: `?internal=1` registers the persistent super property `internal: true`, `?internal=0` unregisters it, and `navigator.webdriver === true` registers `automated: true`. Tagged visitors are still captured, only filterable.
3. Captures `lockin_waitlist_joined` (properties `form`, `life_area`, `duration`, `months`) on a real successful join, and `lockin_waitlist_reason_added` (no free text) when the thank-you step saves a reason. Email, name and free text never reach PostHog.
4. Documents it all in a new `apps/website/app_docs/analytics.md`, the env var table, and `docs/conditional-docs.md`.

## User Story

As the owner of issebya.homes running the lock-in waitlist experiment
I want PostHog to count only real production visitors and to record each waitlist sign-up
So that the conversion numbers I read are not inflated by previews, my own visits or test robots

## Problem Statement

- `NODE_ENV` is `production` on Vercel previews, so the current gate does not limit analytics to production.
- There is no way to filter the owner's or automated browsers' events.
- `src/app/lockin-waitlist/` has no PostHog call, so the experiment's one conversion is invisible.

## Solution Statement

A small pure module `src/lib/analytics.ts` holds the start-up decision (`startAnalytics(env, browser, client)`) and the `?internal=` parsing (`internalTagAction`), with PostHog passed in as a minimal client interface so the whole condition is unit-testable in node, the same shape as adw-dashboard's `src/lib/analytics.ts`. `instrumentation-client.ts` reads the three `NEXT_PUBLIC_*` variables literally (Next inlines only literal reads), builds the browser facts from `navigator`/`window`, and passes an adapter over `posthog` that keeps today's init options (`api_host`, `defaults: "2026-01-30"`, `capture_exceptions: true`). Unlike adw-dashboard, an automated browser is still initialised and tagged `automated: true` rather than skipped (the issue requires tagging, not exclusion).

Super properties are registered from posthog-js's `loaded` init callback so the first `$pageview` of the session already carries them (matters most for `automated`, where every session is fresh). The implementer verifies in `node_modules/posthog-js` that `loaded` runs before the initial pageview capture; if it does not, register immediately after `init` and record that in the doc.

The waitlist events are built by a pure helper `src/lib/lockin-waitlist/analytics.ts` that maps a form state to `{ event, properties } | null`: null unless `ok === true` and `followupToken !== ""` (this excludes the honeypot path and validation/general errors). The forms wrap the server action in a module-level client function passed to `useActionState`: it awaits `joinLockinWaitlist`, then calls `posthog.capture` with the helper's result. This fires exactly once per submit, in the submit's own flow, with no `useEffect`. The thank-you form does the same around `saveSignupReason`, capturing `lockin_waitlist_reason_added` with only `form` when the save returns `ok` and the followup token it was given is non-empty. When PostHog is not initialised (local, preview, tests), `posthog.capture` is a no-op, as for every existing event.

## Relevant Files

Use these files to implement the feature:

- `README.md`, `AGENTS.md` - repo conventions (yarn only, conventional commits, test gates).
- `apps/website/AGENTS.md` - website rules; which test layers gate (browser tests gate on push, Playwright e2e does not run in CI).
- `docs/conditional-docs.md` - index; add the new analytics doc entry at the end of `## apps/website`.
- `apps/website/src/instrumentation-client.ts` - current PostHog init gated on `NODE_ENV`; rewire to `startAnalytics`. Sentry block above it must stay byte-identical.
- `apps/website/src/proxy.ts` - CSP already allows `NEXT_PUBLIC_POSTHOG_HOST` and its `-assets` host; must stay unchanged.
- `apps/website/src/app/lockin-waitlist/actions.ts` - `joinLockinWaitlist` / `saveSignupReason`; read only, behaviour must not change. Shows the honeypot success shape (`ok: true`, `followupToken: ""`).
- `apps/website/src/app/lockin-waitlist/_components/WaitlistShortForm.tsx` - hero form; wrap its action, pass `form="short"` to the thank-you.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistFullForm.tsx` - full form; wrap its action, pass `form="full"`.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistThankYou.tsx` - reason step; wrap `saveSignupReason`, accept a `form` prop.
- `apps/website/src/app/lockin-waitlist/_components/WaitlistForms.browser.test.tsx` - existing browser test of both forms with `../actions` mocked; extend with a `posthog-js` mock.
- `apps/website/src/lib/lockin-waitlist/schema.ts` - `LockinWaitlistFormState` (with echoed `answers: { name, lifeArea, duration, months }`), `SignupReasonFormState`.
- `apps/website/src/lib/lockin-waitlist/copy.ts` - option values for life area, duration, months (for test fixtures).
- `apps/website/src/app/ui/WhatsAppLink.tsx`, `apps/website/src/app/(main)/shop/[slug]/ui/WishlistDialog.browser.test.tsx` - existing `posthog.capture` call pattern and the `vi.mock("posthog-js", ...)` pattern to copy.
- `apps/website/vitest.config.ts` - `unit` (`src/**/*.unit.test.ts`, node) and `browser` projects; `posthog-js` already in `optimizeDeps.include`.
- `apps/website/.env.example` - PostHog vars; add the production-only comment.
- `apps/website/app_docs/environment-setup.md` - the doc listing variables (there is no `docs/vercel-env-vars-sop.md`); add a PostHog section.
- `apps/website/app_docs/testing/unit_test_spec_format.md`, `apps/website/app_docs/testing/component_test_spec_format.md` - test formats.
- `apps/website/app_docs/feature-7deb859c-lockin-waitlist-landing-page.md` - lock-in waitlist design notes.
- `apps/website/app_docs/environment-setup.md` - conditional-docs entry applies (env vars).
- Reference (outside this repo, read only): `~/Dev/issebya/adw-dashboard/src/lib/analytics.ts`, `src/lib/analytics.test.ts`, `app_docs/analytics.md` ("Internal devices").

### New Files

- `apps/website/src/lib/analytics.ts` - `internalTagAction`, `AnalyticsEnv`, `AnalyticsBrowser`, `AnalyticsClient`, `startAnalytics`.
- `apps/website/src/lib/__tests__/analytics.unit.test.ts` - init gate, internal tag, automated tag.
- `apps/website/src/lib/lockin-waitlist/analytics.ts` - `LockinWaitlistForm` type, `lockinWaitlistJoinedEvent`, `lockinWaitlistReasonAddedEvent`.
- `apps/website/src/lib/lockin-waitlist/__tests__/analytics.unit.test.ts` - event helper tests (never email/name).
- `apps/website/app_docs/analytics.md` - analytics section: rules, events table, internal tag, PostHog filters.

## Implementation Plan

### Phase 1: Foundation

Pure, posthog-free modules with unit tests: the start-up decision in `src/lib/analytics.ts` and the waitlist event mapping in `src/lib/lockin-waitlist/analytics.ts`.

### Phase 2: Core Implementation

Rewire `instrumentation-client.ts` to `startAnalytics` with a posthog adapter; wrap the two waitlist forms' and the thank-you form's actions to capture the events.

### Phase 3: Integration

Extend the existing waitlist browser test with a `posthog-js` spy; update `.env.example`, `environment-setup.md`, the new `analytics.md`, and `docs/conditional-docs.md`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the docs that apply

- `apps/website/AGENTS.md`, `app_docs/testing/unit_test_spec_format.md`, `app_docs/testing/component_test_spec_format.md`, `app_docs/environment-setup.md`.
- Read the relevant Next.js doc in `node_modules/next/dist/docs/` on `instrumentation-client` and on `NEXT_PUBLIC_` env inlining (website AGENTS rule).
- In `node_modules/posthog-js`, confirm the order in which `init` calls the `loaded` callback and captures the initial `$pageview` (search the dist for `loaded(` and the initial pageview capture). Note the finding for the doc.

### 2. Create `apps/website/src/lib/analytics.ts`

- `const INTERNAL_PROPERTY = "internal"` and `const AUTOMATED_PROPERTY = "automated"`, each with a comment that the PostHog filter matches the literal; never rename.
- `export type InternalTagAction = "tag" | "untag" | null;` and `export function internalTagAction(search: string): InternalTagAction` (`"1"` tag, `"0"` untag, anything else or absent null), via `new URLSearchParams(search)`.
- `export interface AnalyticsEnv { vercelEnv; projectToken; host }` (all `string | undefined`).
- `export interface AnalyticsBrowser { webdriver: boolean | undefined; search: string }`.
- `export interface AnalyticsClient { init(projectToken: string, host: string, onLoaded: () => void): void; register(properties: Record<string, true>): void; unregister(property: string): void }`.
- `export function startAnalytics(env, browser: AnalyticsBrowser | undefined, client): boolean`: return false (no call on `client`, no throw, no console output) unless `env.vercelEnv === "production"`, `env.projectToken`, `env.host` are all truthy and `browser` is defined. Otherwise call `client.init(token, host, onLoaded)` and return true; `onLoaded` applies: `webdriver === true` -> `register({ automated: true })`; `internalTagAction(search)` tag -> `register({ internal: true })`, untag -> `unregister("internal")`. Never call any opt-out.
- Short doc comments in the style of the adw-dashboard module; no posthog-js import in this file.

### 3. Unit tests `apps/website/src/lib/__tests__/analytics.unit.test.ts`

- Fake client built from `vi.fn()`s whose `init` invokes `onLoaded` synchronously.
- Init gate: production + both vars -> `init` called with token and host, returns true; `vercelEnv` `"preview"`, `"development"`, `undefined` -> no init, returns false, does not throw; missing token, missing host -> no init; `browser === undefined` -> no init.
- Internal tag: `?internal=1` -> `register({ internal: true })`; `?internal=0` -> `unregister("internal")`; `?internal=yes` and `""` -> neither; also `internalTagAction` table-tested directly.
- Automated: `webdriver: true` -> `register({ automated: true })` and init still called; `false`/`undefined` -> no automated register. Combined `webdriver: true` + `?internal=1` registers both.
- Assert the fake client has no opt-out method called (the interface has none; assert `register`/`unregister` are the only calls besides `init`).

### 4. Rewire `apps/website/src/instrumentation-client.ts`

- Leave the Sentry `init`/`onRouterTransitionStart` part unchanged.
- Replace the `NODE_ENV` block with a `startAnalytics(...)` call:
  - env: `{ vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, host: process.env.NEXT_PUBLIC_POSTHOG_HOST }` (literal reads, so Next inlines them).
  - browser: `typeof window === "undefined" ? undefined : { webdriver: navigator.webdriver, search: window.location.search }`.
  - client adapter: `init: (token, host, onLoaded) => posthog.init(token, { api_host: host, defaults: "2026-01-30", capture_exceptions: true, loaded: () => onLoaded() })`, `register: (p) => posthog.register(p)`, `unregister: (p) => posthog.unregister(p)`.
  - If step 1 showed `loaded` runs after the first pageview, call `onLoaded()` right after `posthog.init` instead and say so in `analytics.md`.

### 5. Create `apps/website/src/lib/lockin-waitlist/analytics.ts`

- `export type LockinWaitlistForm = "short" | "full";`
- `type AnalyticsEvent = { event: string; properties: Record<string, string | string[]> }`.
- `export function lockinWaitlistJoinedEvent(form, state: LockinWaitlistFormState): AnalyticsEvent | null`: null unless `state.ok && state.followupToken !== ""`. Properties built by explicit picking (never spreading `state` or `answers`): `form`, plus `life_area` if `answers.lifeArea` is non-empty, `duration` if non-empty, `months` if the array is non-empty. Never `email`, `name`, tokens.
- `export function lockinWaitlistReasonAddedEvent(form, followupToken: string, state: SignupReasonFormState): AnalyticsEvent | null`: null unless `state.ok && followupToken !== ""`; properties `{ form }` only (no reason text).
- Event names as exported constants `LOCKIN_WAITLIST_JOINED = "lockin_waitlist_joined"`, `LOCKIN_WAITLIST_REASON_ADDED = "lockin_waitlist_reason_added"` only if a test or component needs them; otherwise inline literals (knip flags unused exports).

### 6. Unit tests `apps/website/src/lib/lockin-waitlist/__tests__/analytics.unit.test.ts`

- Success from the short form (empty answers) -> `{ event: "lockin_waitlist_joined", properties: { form: "short" } }`.
- Success from the full form with name, life area, duration and two months -> properties exactly `{ form: "full", life_area, duration, months }`; assert serialised properties contain neither the email nor the name string and have no `email`/`name` keys.
- Honeypot shape (`ok: true`, `followupToken: ""`) -> null; validation error (`ok: false` with `errors`) -> null; general error -> null.
- Reason: ok + token -> `{ event: "lockin_waitlist_reason_added", properties: { form } }`; empty token -> null; `ok: false` -> null.

### 7. Wrap the actions in the components

- `WaitlistShortForm.tsx` / `WaitlistFullForm.tsx`: add a module-level client function per form, e.g.
  `async function joinFromShortForm(prev, formData) { const next = await joinLockinWaitlist(prev, formData); const tracked = lockinWaitlistJoinedEvent("short", next); if (tracked) posthog.capture(tracked.event, tracked.properties); return next; }`
  and pass it to `useActionState` instead of `joinLockinWaitlist`. Module level keeps a stable identity. A small shared factory in `FormParts.tsx` or the analytics module is fine if it reads cleaner, but it must not import posthog-js into `src/lib`.
- Pass `form="short"` / `form="full"` to `<WaitlistThankYou>`.
- `WaitlistThankYou.tsx`: accept `form: LockinWaitlistForm`; wrap `saveSignupReason` in a function created with `useCallback`/closure over `form` and `followupToken` (or read both from the submitted `FormData`'s hidden `followupToken` plus a hidden-free closure for `form`), capture `lockinWaitlistReasonAddedEvent(...)` when non-null. Keep the hidden input and every existing prop/behaviour.
- No `useEffect`. The server actions, DB writes and emails stay untouched.

### 8. Extend `WaitlistForms.browser.test.tsx`

- Add `const mockCapture = vi.fn(); vi.mock("posthog-js", () => ({ default: { capture: (...args: unknown[]) => mockCapture(...args) } }));` as in `WishlistDialog.browser.test.tsx`.
- Short form success (`mockJoin` resolves the existing `success` fixture): exactly one `mockCapture` call, `("lockin_waitlist_joined", { form: "short" })`; no argument contains `guest@example.com`.
- Full form success with answers echoed: one call with `form: "full"` and the choice properties, no `name`/`email`.
- Validation error (`ok: false`, `errors.email` set): `mockCapture` not called.
- Honeypot (`ok: true`, `followupToken: ""`): thank-you renders, `mockCapture` not called.
- Reason submit after a real join: `lockin_waitlist_reason_added` captured once with `{ form }`, and the typed reason text appears in no capture argument.
- These fail today because nothing calls `posthog.capture`.
- No Playwright spec: in the local e2e run PostHog is deliberately not initialised (step 4's gate), so `window.posthog` does not exist there and stubbing it would test the stub; the Vitest browser layer renders the real forms with only the action mocked and is a gating layer on push and in CI.

### 9. Negative check (not committed)

- Temporarily change the gate in `startAnalytics` to accept any `vercelEnv` when `process.env.NODE_ENV === "production"` (the old behaviour), run `yarn workspace website vitest run --project unit src/lib/__tests__/analytics.unit.test.ts` with `NODE_ENV=production`, confirm the "preview: no init" test fails, restore the file, and confirm `git diff` shows no trace of it.

### 10. Docs

- `apps/website/.env.example`: comment above the two PostHog vars: set on the Vercel **Production** environment only, from PostHog project `ihai-website` (EU); leave unset locally and on Preview; `NEXT_PUBLIC_VERCEL_ENV` is provided by Vercel.
- `apps/website/app_docs/environment-setup.md`: add an "Analytics" table with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST` (Production only) and `NEXT_PUBLIC_VERCEL_ENV` (system variable, not set by hand), linking to `analytics.md`.
- New `apps/website/app_docs/analytics.md`: production-only rule and why (`NODE_ENV` is production on previews); the start-up module; events table: all existing events listed by name (`room_tab_clicked`, `whatsapp_link_clicked`, `gallery_image_viewed`, `booking_calendar_opened`, `booking_dates_selected`, `checkout_session_created`, shop events, `captureException`) as unchanged, plus `lockin_waitlist_joined` (`form`, `life_area`, `duration`, `months`; fired when the action returns ok with a non-empty followup token) and `lockin_waitlist_reason_added` (`form`); never email, name or free text; internal tag with the owner's one-time step (open `https://issebya.homes/?internal=1` once per browser as a full page load; `?internal=0` to undo); `automated: true` for `navigator.webdriver`; PostHog filter "event property `internal` is not set" and "`automated` is not set" (set by hand in project settings); UTM handled by posthog-js on `$pageview`, never strip query strings from `/lockin-waitlist` links; the `loaded` ordering finding from step 1.
- `docs/conditional-docs.md`: append at the end of `## apps/website` an entry for `apps/website/app_docs/analytics.md` with conditions: when adding or changing a PostHog event or `posthog.capture` call; when changing PostHog init, its env vars or the internal/automated tags; when PostHog numbers include previews, the owner or test browsers.

### 11. Run the Validation Commands

- Run every command below; all must pass.

## Testing Strategy

### Unit Tests

- `src/lib/__tests__/analytics.unit.test.ts`: `startAnalytics` gate (production + both vars init; preview/development/undefined env, missing token, missing host, no browser: no init, no throw), `internalTagAction` (`1`, `0`, other, absent), automated tag, combined tags, no opt-out.
- `src/lib/lockin-waitlist/__tests__/analytics.unit.test.ts`: joined event for short/full, honeypot/validation/general error null, never `email`/`name`; reason event ok/empty token/not ok.

### Test Coverage

- Unit (`analytics.unit.test.ts`): catches PostHog initialising on a Vercel preview or local build, and the internal/automated tags not being applied; nothing tests init today.
- Unit (`lockin-waitlist/__tests__/analytics.unit.test.ts`): catches PII (email, name) leaking into the event and the honeypot or error paths counting as conversions.
- Browser (`WaitlistForms.browser.test.tsx` extension): catches the forms not capturing exactly one `lockin_waitlist_joined` per real join (with the right `form`), capturing on validation error or honeypot, or capturing reason text; nothing captures today so these fail without the change.
- No Playwright e2e spec: PostHog is intentionally off on the local server the e2e suite hits, so there is nothing real to observe there; the browser layer above covers the component behaviour and gates CI.

### Edge Cases

- `?internal=1&internal=0` (first value wins via `URLSearchParams.get`), `?internal=` empty, `?INTERNAL=1` (case-sensitive, no-op).
- `navigator.webdriver` undefined in older browsers.
- Repeat submit of the same email (merge path) still returns a token and counts as a join; documented.
- Full form submitted with only some answers: absent answers are omitted, not sent as empty strings.
- Thank-you reason after a honeypot join (empty token): no event.
- Reason validation error (empty or too long): no event.
- PostHog not initialised: `posthog.capture` no-op, no console error.

## Acceptance Criteria

- PostHog initialises only when `NEXT_PUBLIC_VERCEL_ENV === "production"` and both PostHog vars are set; otherwise silently skipped.
- `?internal=1` registers `internal: true`, `?internal=0` unregisters it, other values do nothing; `navigator.webdriver === true` registers `automated: true`; no opt-out anywhere.
- A real successful join captures exactly one `lockin_waitlist_joined` with `form` and only answered `life_area`/`duration`/`months`; honeypot and errors capture nothing; email, name and free text never sent.
- A saved reason captures `lockin_waitlist_reason_added` with `{ form }` only.
- Existing event names/properties, the CSP in `src/proxy.ts`, the Sentry setup, and the waitlist actions' behaviour are unchanged (`git diff` shows no change to `proxy.ts` or `actions.ts`, and no change to the Sentry block).
- `analytics.md`, `environment-setup.md`, `.env.example` and the `conditional-docs.md` entry are updated.
- All validation commands pass; the negative check was run and left no trace.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn turbo run typecheck --filter=./apps/website` - new modules, adapter and component props typecheck.
- `yarn turbo run lint --filter=./apps/website` - lint rules (incl. no-secrets) pass.
- `yarn prettier --check .` - formatting, including the new docs and spec.
- `yarn knip` - no unused exports from the new modules.
- `yarn turbo run test --filter=./apps/website` - unit and chromium browser projects, including the new and extended tests.
- `yarn turbo run build --filter=./apps/website` - production build with the rewired `instrumentation-client.ts`.

## Notes

- No new dependency; `posthog-js` is already installed.
- `NEXT_PUBLIC_VERCEL_ENV` is a Vercel system variable exposed to Next.js builds when "Automatically expose System Environment Variables" is on (the default). After the owner adds the PostHog vars to Production and this ships, check one preview deploy sends nothing and production sends `$pageview`. If the system variable turns out not to be exposed, the fallback is `env: { NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV }` in `next.config.ts`; do not add that pre-emptively.
- Deliberate difference from adw-dashboard: automated browsers are initialised and tagged, not skipped, as the issue requires.
- Out of scope: PostHog insights/dashboards, cookie consent, `posthog-node`, anything under `adws/`.
- The owner's manual steps after deploy: add the two PostHog vars (from `ihai-website`, EU, id 259921) to the Vercel Production environment only; open `https://issebya.homes/?internal=1` once per browser; set the "internal is not set" / "automated is not set" test-account filter in PostHog.
