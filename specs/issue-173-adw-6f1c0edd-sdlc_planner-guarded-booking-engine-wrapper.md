# Chore: one guarded booking engine wrapper (`GuardedBookingEngine`)

## Metadata

issue_number: `173`
adw_id: `6f1c0edd`
issue_json: `{"number":173,"title":"website: one guarded booking engine wrapper — BookingWidget.roomEngine and booking/[type]/page.tsx duplicate the same ErrorBoundary + Suspense + fallback block"}`

## Chore Description

The same "booking engine, guarded" block exists twice in `apps/website`:

- `src/app/(main)/blog/ui/BookingWidget.tsx`, `function roomEngine(roomType)`: Sentry `<ErrorBoundary>` whose fallback is `div.booking-engine-error > p.text-sm.text-red-600` with the copy "Booking is temporarily unavailable. Please reach out to us on <WhatsAppLink /> to book directly.", wrapping `<Suspense fallback={<BookingEngineSkeleton />}><BookingEngine roomType={roomType} /></Suspense>`.
- `src/app/(main)/booking/[type]/page.tsx` (lines ~132-145): the identical JSX inline.

A third copy of the same _sentence_ (not the same structure) is in `src/app/(main)/booking/[type]/ui/BookingClient.tsx:254`, the client's own `hasAvailabilityError` branch.

This chore extracts one named Server Component, `GuardedBookingEngine({ roomType })`, used by both call sites, and moves the fallback sentence into one constant used by the wrapper and by `BookingClient`. It is a pure refactor: rendered DOM, classes, copy, and Suspense placement stay identical. Two facts must survive: the `Suspense` is required because `BookingClient` calls `useSearchParams()` (static rendering), and its fallback is `BookingEngineSkeleton`, not `null` (see the restore-booking-engine-skeleton app_doc).

### Design decisions (fixed here so the implementer does not re-decide them)

- **Copy module**: no existing copy module exists under `apps/website/src/lib` (checked: `src/lib/shared/` holds `country-codes.ts`, `guest-contacts.ts`, `supabase.ts`, `validation.ts`, `schemas/`, `types/`, none of them copy). Create the new file `apps/website/src/lib/shared/booking-copy.ts` as the issue suggests.
- **Constant shape**: the sentence has `<WhatsAppLink />` in the middle, so it cannot be a single string. Export
  ```ts
  export const BOOKING_UNAVAILABLE_COPY = {
    lead: "Booking is temporarily unavailable. Please reach out to us on ",
    tail: " to book directly.",
  } as const;
  ```
  and render it as `{BOOKING_UNAVAILABLE_COPY.lead}<WhatsAppLink />{BOOKING_UNAVAILABLE_COPY.tail}` with **no** whitespace/JSX text between the three children. That yields exactly the same children as today's JSX (text node "…us on ", the link, text node " to book directly."); JSX collapses today's newline+indent into a single space, which is what `tail`'s leading space reproduces. Do not write `{lead} <WhatsAppLink /> {tail}`: that inserts extra text nodes (and double spaces).
  Keep "Booking is temporarily unavailable" contiguous in `lead` so the grep verification returns exactly one hit.
- **No `"use client"`** on `GuardedBookingEngine.tsx` or `booking-copy.ts`. `BookingEngine` is an async Server Component and must stay one; `ErrorBoundary` from `@sentry/nextjs` is already rendered from Server Components in both call sites; `WhatsAppLink` is already a client component and is used from Server Components today. `booking-copy.ts` is a plain constant with no React import, so it is importable from both the Server Component wrapper and the `"use client"` `BookingClient`.
- **`BookingClient`** keeps its own `div.booking-engine-error > p.text-sm.text-red-600` markup (issue: "shares the copy, not the structure"); only the sentence text is replaced by the constant. No behaviour change.

## Relevant Files

Use these files to resolve the chore:

- `AGENTS.md` - repo conventions (yarn only, conventional commits, lefthook, `--filter` by path).
- `apps/website/AGENTS.md` - server components by default, no new client boundaries, browser tests stay component-scoped, e2e runs on the run's port and is not in CI.
- `docs/conditional-docs.md` - index; matched entries: `component-patterns-guide.md` (same JSX appears more than once), `feature-675f0da1-restore-booking-engine-skeleton.md` (changing the Suspense/fallback around `BookingEngine`), `feature-fe1ca663-blog-with-booking-widget.md` (changing `BookingWidget`), `nextjs-patterns-guide.md` (Server Component), `testing/component_test_spec_format.md` (new browser test), `import-patterns-guide.md` (imports).
- `apps/website/app_docs/component-patterns-guide.md` - conventions for extracting a shared component.
- `apps/website/app_docs/nextjs-patterns-guide.md` - Server vs Client Component rules.
- `apps/website/app_docs/import-patterns-guide.md` - destructured imports.
- `apps/website/app_docs/testing/component_test_spec_format.md` - browser test conventions.
- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md` - must get one line pointing at `GuardedBookingEngine.tsx` as where the skeleton fallback now lives.
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` - line 15 describes the widget rendering "behind the same `ErrorBoundary` + `Suspense`/`BookingEngineSkeleton` pair"; update to name `GuardedBookingEngine`.
- `apps/website/src/app/(main)/blog/ui/BookingWidget.tsx` - delete `roomEngine`, use `GuardedBookingEngine`, update doc comment, drop now-unused imports (`Suspense`, `ErrorBoundary`, `WhatsAppLink`, `BookingEngine`, `BookingEngineSkeleton`).
- `apps/website/src/app/(main)/booking/[type]/page.tsx` - replace the inline block with `<GuardedBookingEngine roomType={roomType} />`; drop `Suspense`, `ErrorBoundary`, `BookingEngine`, `BookingEngineSkeleton` imports. **Keep the `WhatsAppLink` import**: it is still used by the "For special requests…" paragraph at the bottom of the page.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.tsx` - line ~254 uses the constant.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngine.tsx` - wrapped component (read only; unchanged).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.tsx` - Suspense fallback; its `data-testid="booking-skeleton-dates"` is what the new test asserts (unchanged).
- `apps/website/src/app/ui/WhatsAppLink.tsx` - client link used in the fallback; imports `posthog-js` (mock it in the browser test).
- `apps/website/src/app/(main)/booking/[type]/ui/BookingClient.browser.test.tsx` - asserts `/booking is temporarily unavailable/i`; must stay green unchanged.
- `apps/website/src/app/(main)/booking/[type]/ui/BookingEngineSkeleton.browser.test.tsx`, `apps/website/src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx` - must stay green unchanged.
- `apps/website/src/app/globals.css` - styles `.booking-engine-error` (line ~102); class name must not change.
- `apps/website/vitest.config.ts` - browser project includes `src/app/**/*.browser.test.tsx`; `@sentry/nextjs` and `posthog-js` already in `optimizeDeps.include`.
- `apps/website/e2e/booking-flow.integration.spec.ts`, `blog-booking-flow.integration.spec.ts`, `booking-calendar-close-scroll.integration.spec.ts` - regression coverage of both call sites; must pass unchanged. (Note: none of them currently assert the "temporarily unavailable" text; grep of `apps/website/e2e` finds no hit. They cover the happy path rendered through the wrapper.)
- `knip.json` - `apps/website` entry covers `*.browser.test.tsx`; the new export is used by two files, so no ignore entry is needed.

### New Files

- `apps/website/src/lib/shared/booking-copy.ts` - exports `BOOKING_UNAVAILABLE_COPY`.
- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.tsx` - the Server Component wrapper.
- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.browser.test.tsx` - component-scoped browser test.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Capture "before" screenshots

- Start the website dev server on this run's port (`PORT=<run port> yarn workspace website dev`; never assume 3000, never start telegram-router or guest-communication-agent).
- Screenshot `/booking/room1` and a blog post that contains `<BookingWidget />` (find one with `grep -rl "BookingWidget" apps/website/src/content/blog`) at desktop and mobile widths. Save them for the after comparison.

### 2. Add the copy constant

- Create `apps/website/src/lib/shared/booking-copy.ts` exporting `BOOKING_UNAVAILABLE_COPY = { lead, tail } as const` exactly as in "Design decisions". Add a short comment: the sentence surrounds `<WhatsAppLink />`, render as `{lead}<WhatsAppLink />{tail}`, shared by `GuardedBookingEngine`'s error fallback and `BookingClient`'s availability-error state so the wording cannot drift.

### 3. Create `GuardedBookingEngine.tsx`

- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.tsx`, no `"use client"`.
- Props: `{ roomType: BookingType }` (import `BookingType` type from `@/lib/shared/types/booking`, the type both call sites already pass; it is assignable to `BookingEngine`'s `"room1" | "room2"`).
- Body: `<ErrorBoundary fallback={<div className="booking-engine-error"><p className="text-sm text-red-600">{BOOKING_UNAVAILABLE_COPY.lead}<WhatsAppLink />{BOOKING_UNAVAILABLE_COPY.tail}</p></div>}><Suspense fallback={<BookingEngineSkeleton />}><BookingEngine roomType={roomType} /></Suspense></ErrorBoundary>`.
- Imports: `Suspense` from `react`, `ErrorBoundary` from `@sentry/nextjs`, `WhatsAppLink` from `@/app/ui/WhatsAppLink`, `BOOKING_UNAVAILABLE_COPY` from `@/lib/shared/booking-copy`, `./BookingEngine`, `./BookingEngineSkeleton`.
- Doc comment: move the reasoning currently in the widget comment here: why the Sentry boundary (WhatsApp fallback if the engine throws), why the `Suspense` is required (`BookingClient`'s `useSearchParams()` vs static rendering), why the fallback is `BookingEngineSkeleton` not `null` (point at `app_docs/feature-675f0da1-restore-booking-engine-skeleton.md`), and that it is a Server Component because `BookingEngine` reads cached availability.

### 4. Use it in `booking/[type]/page.tsx`

- Replace the whole `<ErrorBoundary …>…</ErrorBoundary>` block with `<GuardedBookingEngine roomType={roomType} />`, same position inside `div.space-y-6`.
- Remove imports `Suspense`, `ErrorBoundary`, `BookingEngine`, `BookingEngineSkeleton`; add `import { GuardedBookingEngine } from "./ui/GuardedBookingEngine";`. Keep `WhatsAppLink`. Nothing else in the file changes.

### 5. Use it in `BookingWidget.tsx`

- Delete `function roomEngine`.
- `<RoomSwitcher room1={<GuardedBookingEngine roomType={BookingType.room1} />} room2={<GuardedBookingEngine roomType={BookingType.room2} />} />`.
- Remove imports `Suspense`, `ErrorBoundary`, `WhatsAppLink`, `BookingEngine`, `BookingEngineSkeleton`; add `import { GuardedBookingEngine } from "../../booking/[type]/ui/GuardedBookingEngine";`. Keep `BOOKING_WIDGET_ANCHOR_ID`, `BookingType`, `RoomSwitcher`.
- Update the doc comment: replace the sentence describing the ErrorBoundary/Suspense/skeleton nesting (and the Suspense rationale) with "Each room's node is `<GuardedBookingEngine>`, the same component `booking/[type]/page.tsx` renders; see it for why the boundary and the skeleton fallback are there." Keep every other paragraph (props interleaving, cache tags, no room prop, anchor id) as is. The `<aside>` markup is untouched.

### 6. Use the constant in `BookingClient.tsx`

- In the `hasAvailabilityError && !checkInDate` branch, replace the literal sentence with `{BOOKING_UNAVAILABLE_COPY.lead}<WhatsAppLink />{BOOKING_UNAVAILABLE_COPY.tail}`; import the constant from `@/lib/shared/booking-copy`. Markup and everything else unchanged.

### 7. Add `GuardedBookingEngine.browser.test.tsx`

- Location: `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.browser.test.tsx`. Follow `component_test_spec_format.md` and the style of `BookingEngineSkeleton.browser.test.tsx` / `RoomSwitcher.browser.test.tsx`.
- `vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))` (WhatsAppLink imports it).
- `vi.mock("./BookingEngine", …)` with a **synchronous** stub `BookingEngine({ roomType })` whose behaviour is driven by a module-level `vi.hoisted` mode variable: `"render"` returns `<div data-testid="mock-engine">{roomType}</div>`; `"throw"` throws `new Error("boom")`; `"suspend"` throws a never-resolving promise (or `use(new Promise(() => {}))`) so the Suspense fallback shows. The real `BookingEngine` must not be imported (it pulls in `getAvailability`/Supabase).
- Tests:
  1. normal child: renders `mock-engine` with the room type inside; no `.booking-engine-error`, no `booking-skeleton-dates`.
  2. throwing child: `.booking-engine-error p.text-red-600` is present, its text equals `BOOKING_UNAVAILABLE_COPY.lead + "WhatsApp (+351 920 742 845)" + BOOKING_UNAVAILABLE_COPY.tail` (proves exact spacing), and it contains a link with `href="https://wa.me/351920742845"`. Silence the expected React/Sentry console error with `vi.spyOn(console, "error").mockImplementation(() => {})` and restore after.
  3. suspending child: `getByTestId("booking-skeleton-dates")` is in the document (the real `BookingEngineSkeleton`, not mocked).
- **Negative check**: temporarily replace the `ErrorBoundary` in `GuardedBookingEngine.tsx` with a fragment, run the test file, confirm test 2 fails; revert and confirm green. Record in the implementation report that this was tried and reverted. Optionally do the same with `fallback={null}` on Suspense to confirm test 3 fails.

### 8. Update docs

- `apps/website/app_docs/feature-675f0da1-restore-booking-engine-skeleton.md`: add one line (e.g. under `## Notes`): "The `<Suspense fallback={<BookingEngineSkeleton />}>` now lives in `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.tsx`, used by both `booking/[type]/page.tsx` and the blog `BookingWidget` (issue #173)."
- `apps/website/app_docs/feature-fe1ca663-blog-with-booking-widget.md` line 15: say the widget renders `<GuardedBookingEngine>` for each room (the same component `/booking/[type]` uses).
- `docs/conditional-docs.md`: in the `feature-675f0da1-restore-booking-engine-skeleton.md` entry, change the first condition to "When changing the `<Suspense>` boundary or fallback around `BookingEngine` in `GuardedBookingEngine.tsx`" (the path moved). No new doc file, so no new entry.
- No em-dashes in any new copy or comments.

### 9. Verify rendered output and copy uniqueness

- `grep -rn "Booking is temporarily unavailable" apps/website/src` must return exactly one hit, in `src/lib/shared/booking-copy.ts`. Paste the output in the report. (The existing test regex `/booking is temporarily unavailable/i` is lowercase and does not match this case-sensitive grep.)
- With the dev server on this run's port, take the "after" screenshots of the same pages/widths as step 1 and compare: they must be visually identical. Also compare the served HTML of `/booking/room1` around `.booking-engine` before/after if feasible.
- Confirm prerendering: in `yarn turbo run build --filter=./apps/website` output, `/booking/[type]` (room1, room2) and `/blog/[slug]` are still listed as prerendered (● / ◐), not dynamic (ƒ).

### 10. Run the Validation Commands

- Run every command below; all must pass.
- Run the e2e specs on this run's port: `yarn workspace website test:integration` (or the specific `booking-flow`, `blog-booking-flow`, `booking-calendar-close-scroll` specs) with the dev server started on the run's port.

## Test Coverage

- `apps/website/src/app/(main)/booking/[type]/ui/GuardedBookingEngine.browser.test.tsx` (browser layer, needs a real DOM and React error/suspense boundaries): catches removal of the `ErrorBoundary` (throwing engine no longer degrades to the WhatsApp fallback), drift in the fallback markup/spacing of the shared copy, and a `Suspense` fallback that is no longer `BookingEngineSkeleton`. Today nothing tests the boundary at all: `BookingClient.browser.test.tsx` only covers the client's own error branch, and the skeleton app_doc explicitly notes the Suspense wiring is untested.
- Existing `BookingClient.browser.test.tsx` (unchanged) keeps covering the `hasAvailabilityError` branch now rendered from the constant.
- No new e2e spec: the user-visible flow does not change; existing `booking-flow`, `blog-booking-flow` and `booking-calendar-close-scroll` specs already exercise both call sites end to end and must pass unchanged.
- No unit test for `booking-copy.ts`: it is a constant, and the browser test asserts its rendered form.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `grep -rn "Booking is temporarily unavailable" apps/website/src` - exactly one hit, in `src/lib/shared/booking-copy.ts`
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/website` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/website` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies (catches leftover `Suspense`/`ErrorBoundary`/`BookingEngineSkeleton` imports)
- `yarn turbo run test --filter=./apps/website` - unit + browser projects, including the new `GuardedBookingEngine` test and the unchanged `BookingClient`, `BookingEngineSkeleton`, `RoomSwitcher` tests
- `yarn turbo run build --filter=./apps/website` - Production build succeeds; `/booking/[type]` and `/blog/[slug]` still prerendered
- `yarn workspace website test:integration` (dev server on this run's port) - `booking-flow`, `blog-booking-flow`, `booking-calendar-close-scroll` specs pass

## Notes

- Out of scope: changing the fallback wording or styling, `ShopGridBoundary` (#169), any change to `BookingEngine`/`BookingClient` behaviour.
- The issue says "the e2e specs assert on the text"; a grep of `apps/website/e2e` shows they do not assert "temporarily unavailable" (only `BookingClient.browser.test.tsx` does). The markup is kept identical regardless.
- `page.tsx` still needs `WhatsAppLink` for its enquiries paragraph; knip/typecheck will not flag it, but do not remove it by reflex.
- Never reset the shared local Supabase; never start dev servers for telegram-router (3003) or guest-communication-agent (3005).
- Conventional commit, e.g. `refactor(website): extract GuardedBookingEngine and shared booking-unavailable copy`, no `Co-Authored-By` trailer.
