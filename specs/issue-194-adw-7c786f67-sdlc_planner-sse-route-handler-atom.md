# Feature: patterns atom `sse-route-handler` with a live progress demo

## Metadata

issue_number: `194`
adw_id: `7c786f67`
issue_json: `{"number":194,"title":"patterns: atom 'sse-route-handler' with a live progress demo inside apps/patterns (blocked by #189)"}`

## Feature Description

Add a new atom doc, `sse-route-handler`, to the `apps/patterns` library, plus a runnable demo inside the same app. The doc explains Server-Sent Events from a Next.js Route Handler: a stream is one long HTTP response, frames are `id:`/`event:`/`data:` lines ended by a blank line, `Last-Event-ID` lets a client resume, the stream ends with an explicit `done` event, a `: ping` comment keeps proxies from closing an idle connection, errors travel as events because the status is already 200, and each open stream holds one function instance for a bounded time.

The demo is a real Route Handler, `GET /api/demo/progress`, that emits five progress events about 500 ms apart and then `done`. A `"use client"` component, `SseProgressDemo`, is imported by the MDX doc and rendered inside `/p/sse-route-handler`: "Run demo" opens an `EventSource`, a progress bar fills with a CSS transition, received events are listed with their ids, "Disconnect" closes the stream, and running again resumes from the last id.

This work is the pattern the sibling issue (live booking confirmation over SSE on the website) will follow, documented before it is used.

## User Story

As the owner (and as a coding agent reading `content/INDEX.md`)
I want to read the SSE Route Handler pattern in a minute and watch it run against a real stream from the same app
So that the booking confirmation timeline is built on a mechanism I have already seen working, with its pitfalls written down

## Problem Statement

Server-Sent Events are about to be used for the booking confirmation timeline, and nothing in the repo documents how to stream from a Route Handler: frame format, resume, heartbeat, error handling after a 200, abort handling, function duration and instance cost. The patterns library holds only React Query and Suspense docs, and it has no way to show a mechanism running, only static excerpts.

## Solution Statement

1. Put the demo producer in a small pure module, `src/lib/sse/progress-stream.ts`, that builds the `ReadableStream` from a list of steps, a resume id, a delay and an `AbortSignal`, and a frame formatter `src/lib/sse/frame.ts`. The route file only parses the resume id (query param first, then the `Last-Event-ID` header) and returns a `Response` with the SSE headers. Next allows only HTTP-method and segment-config exports from `route.ts`, so the logic the tests need lives outside it.
2. Add `SseProgressDemo` under `src/app/demos/` as the app's first and only kind of client component, imported by the MDX doc. The app's "no `"use client"`" rule becomes "client components only for live demos under `src/app/demos/`; every page still prerenders". The doc page stays static: the client component is an island in a prerendered page, and only the API route is dynamic.
3. Give `apps/patterns` a Vitest browser pool (copied from `apps/website`, trimmed) so the component can be tested with a mocked `EventSource`.
4. Write the doc against the committed route and component, pinned to the SHA of the commit that adds them, with `verifiedIn` set to this branch's PR number. Regenerate `INDEX.md` and the manifest.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md` - repo conventions: yarn only, turbo `--filter` by path, no em dashes, Vercel notes.
- `docs/conditional-docs.md` - index of docs; the `apps/patterns` section gets an entry for this feature's `app_docs` file in the document phase.
- `apps/patterns/AGENTS.md` - app rules: SHA pinning, excerpt lines, `verifiedIn` = PR numbers, never hand-edit generated files, `## Code` only `<CodeLinks />`, and the "No `"use client"`" rule that this feature must amend.
- `apps/patterns/README.md` - says "There are no client components" and "node pool only"; both must be updated. Frontmatter reference and "Add a doc" steps.
- `apps/patterns/app_docs/feature-066a1da6-patterns-library-app.md` - how the library was built (registry, manifest, section check, Turbopack plugin constraint).
- `apps/patterns/content/suspense-without-flash.mdx` - the reference atom: frontmatter shape, `Excerpt from <path>, trimmed.` lines, section style, house voice.
- `apps/patterns/content/INDEX.md`, `apps/patterns/src/lib/patterns/manifest.generated.ts` - generated; regenerate with `yarn workspace patterns index`.
- `apps/patterns/src/lib/patterns/schema.ts` - frontmatter contract (summary one sentence ending in `.`, no em dash; `code[].ref` 40-char SHA; `verifiedIn` PR ints).
- `apps/patterns/src/lib/patterns/sections.ts` - atom section order; lines before the first H2 (where the MDX `import` goes) belong to no section and are ignored.
- `apps/patterns/src/lib/patterns/__tests__/content.unit.test.ts`, `generated.unit.test.ts` - the section-order, `code.path` existence and generated-file freshness tests from #189 that must pass for the new doc.
- `apps/patterns/src/app/p/[slug]/page.tsx` - renders `Content`; the demo appears here through the MDX import. No change expected.
- `apps/patterns/src/mdx-components.tsx` - typography; fallback place to register `SseProgressDemo` if an `@/` import inside `.mdx` does not resolve.
- `apps/patterns/src/app/globals.css` - palette and utilities for the demo's styling.
- `apps/patterns/vitest.config.ts` - node pool only today; gets a browser project.
- `apps/patterns/package.json` - devDependencies for the browser pool.
- `apps/patterns/next.config.ts` - `cacheComponents: true`; means no `export const dynamic` in the route (it is rejected under Cache Components). Reading `request` makes the handler dynamic on its own.
- `apps/patterns/tsconfig.json` - `@/*` and `@content/*` aliases.
- `knip.json` - `apps/patterns` entry globs need `src/**/*.browser.test.tsx`.
- `apps/website/vitest.config.ts`, `apps/website/package.json` - the browser pool to copy (versions of `@vitest/browser-playwright`, `@vitejs/plugin-react`, `vitest-browser-react`, `playwright`).
- `apps/website/src/lib/__tests__/use-debounced-value.browser.test.tsx` - browser test style (`vitest-browser-react`, fake timers).
- `apps/website/src/app/api/shop/products/__tests__/route.unit.test.ts` - route unit test style (import `GET`, call with a request).
- `.github/workflows/ci.yml` - installs chromium via `yarn workspace website playwright install --with-deps chromium` and runs `yarn turbo run test`; the patterns browser pool reuses that browser as long as the `playwright` version matches the website's.

### New Files

- `apps/patterns/src/lib/sse/frame.ts` - `formatEvent({ id?, event?, data })` and `formatComment(text)`: pure SSE frame formatting.
- `apps/patterns/src/lib/sse/progress-stream.ts` - `PROGRESS_STEPS`, `SSE_HEADERS`, `parseResumeId`, `createProgressStream({ fromId, delayMs, signal })`.
- `apps/patterns/src/app/api/demo/progress/route.ts` - the demo Route Handler, `GET` only.
- `apps/patterns/src/lib/sse/__tests__/frame.unit.test.ts` - frame format unit tests.
- `apps/patterns/src/app/api/demo/progress/__tests__/route.unit.test.ts` - reads the real `GET` response with a reader.
- `apps/patterns/src/app/demos/SseProgressDemo.tsx` - the `"use client"` demo component.
- `apps/patterns/src/app/demos/SseProgressDemo.browser.test.tsx` - component test with a fake `EventSource`.
- `apps/patterns/content/sse-route-handler.mdx` - the atom doc.

## Implementation Plan

### Phase 1: Foundation

- Confirm PR #192 is merged into the base branch (the worktree's `git log` shows `Merge pull request #192`; it is).
- Add the browser test pool to `apps/patterns` (dependencies, `vitest.config.ts`, `knip.json`).
- Amend the "no client components" rule in `apps/patterns/AGENTS.md` and the README, scoped to `src/app/demos/`.

### Phase 2: Core Implementation

- Pure SSE helpers: frame formatting, the step list, resume-id parsing, the stream factory with abort handling.
- The Route Handler wiring them to a `Response`.
- `SseProgressDemo` with `EventSource`, progress bar, event list, Disconnect and resume.
- Unit tests for frames and the route (including the negative check on abort), browser test for the component.

### Phase 3: Integration

- Commit route and component, push, take the commit SHA and the PR number.
- Write `content/sse-route-handler.mdx` with excerpts from those files at that SHA, import and render `SseProgressDemo` inside the doc.
- Regenerate `INDEX.md` and the manifest, build, confirm `/p/sse-route-handler` is prerendered (`○`/`●`) and `/api/demo/progress` is dynamic (`ƒ`), and `curl -N` the local production server.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Check the base

- `git log --oneline -5` must show the #192 merge. If `apps/patterns` is missing, stop: this issue is blocked by #189.
- Read `apps/patterns/AGENTS.md`, `apps/patterns/README.md` and `apps/patterns/content/suspense-without-flash.mdx` before writing anything.

### 2. Add a browser test pool to `apps/patterns`

- `yarn workspace patterns add -D @vitejs/plugin-react @vitest/browser-playwright vitest-browser-react playwright`, pinning each to the same range `apps/website/package.json` uses (`^5.1.2`, `^4.0.18`, `^2.0.4`, `^1.58.2`) so CI's single `playwright install chromium` (run via the website workspace) serves both.
- Rewrite `apps/patterns/vitest.config.ts`: keep the `unit` node project unchanged; add a `browser` project modelled on the website's (plugins `react()` + `tsconfigPaths()`, `include: ["src/**/*.browser.test.tsx"]`, `browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] }`, `optimizeDeps.include: ["react", "react-dom", "vitest-browser-react"]`). No Tailwind plugin and no setup file: the test asserts roles, text and attributes, not styles. Replace the "Node pool only" comment with one saying why the browser pool exists (the demo is the app's one client component) and why it is chromium only (same reason as the website).
- `knip.json` → `apps/patterns.entry`: add `"src/**/*.browser.test.tsx"`. If knip flags `playwright` as unused, add it to that workspace's `ignoreDependencies` with the reason that it is the peer of `@vitest/browser-playwright`.

### 3. Amend the app rules

- `apps/patterns/AGENTS.md`: replace "No `"use client"` in this app. Every page must stay prerendered." with: client components only for live demos, one file per demo under `src/app/demos/`, imported from the doc's MDX; every page must still prerender, so a demo never reads the request on the server and fetches only from `src/app/api/demo/*`. Add: demo routes under `src/app/api/demo/` take no env vars and touch no database; never add `export const dynamic` to a route (rejected under `cacheComponents`).
- `apps/patterns/README.md`: replace "There are no client components." with a sentence naming the demo exception; change the `test` line comment to "unit (node) and browser (chromium) tests"; add `src/app/api/demo/progress` to "How it works" as the one dynamic route.

### 4. SSE frame helpers

- `src/lib/sse/frame.ts`:
  - `formatEvent({ id, event, data }: { id?: number | string; event?: string; data: unknown }): string` returns `id: <id>\n` (if set) + `event: <event>\n` (if set) + `data: <JSON.stringify(data)>\n` + `\n`. JSON has no raw newlines, so one `data:` line is always enough; say so in a comment.
  - `formatComment(text: string): string` returns `: <text>\n\n`.
- `src/lib/sse/__tests__/frame.unit.test.ts`: exact strings for a full event, an event without id, a comment; a `data` string containing `\n` stays on one `data:` line (escaped by JSON).

### 5. Progress stream and route

- `src/lib/sse/progress-stream.ts`:
  - `PROGRESS_STEPS` as a readonly array of `{ id, percent, step }`: ids 1 to 5, percents 10, 30, 70, 90, 100, short plain step labels (e.g. "Request received", "Checking dates", "Holding the room", "Taking payment", "Confirmed"). No em dashes.
  - `SSE_HEADERS`: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Comment each non-obvious one (`no-transform` stops compression proxies buffering; `X-Accel-Buffering` turns off nginx-style buffering).
  - `parseResumeId(value: string | null): number` returns a non-negative integer or 0 for anything else (missing, negative, non-numeric, above the last id is clamped by the stream simply having nothing left).
  - `createProgressStream({ fromId, delayMs, signal }): ReadableStream<Uint8Array>`: enqueue, for each step with `id > fromId`, first a `formatComment("ping")` (skip it before the very first emitted step), then, after `delayMs`, `formatEvent({ id, event: "progress", data: { percent, step } })`; after the last step `formatEvent({ event: "done", data: { lastId } })` and `controller.close()`. Implement with one `setTimeout` chain held in a variable so it can be cleared. On `signal` abort: `clearTimeout`, and `controller.close()` guarded so a double close does not throw; also clear in the stream's `cancel()` callback (a reader cancelling is the other way a client leaves). If `signal.aborted` is already true at start, close immediately. Encode with one `TextEncoder`.
  - A header comment: in real use the heartbeat is every 15 s while waiting; the demo pings between steps because the whole run is 2.5 s.
- `src/app/api/demo/progress/route.ts`: `export function GET(request: Request)`: `fromId = parseResumeId(new URL(request.url).searchParams.get("lastEventId") ?? request.headers.get("last-event-id"))`, return `new Response(createProgressStream({ fromId, delayMs: 500, signal: request.signal }), { headers: SSE_HEADERS })`. Comment why the query param exists: `EventSource` sends `Last-Event-ID` itself only on its own automatic reconnect, and a new `EventSource` after a manual close starts clean. No `export const dynamic`, no env, no database.
- `src/app/api/demo/progress/__tests__/route.unit.test.ts` (node pool, `vi.useFakeTimers()`):
  - helper `readAll(response)` that pulls chunks with `getReader()` while calling `vi.advanceTimersByTimeAsync(500)` until `done`, then decodes to one string.
  - "emits the exact frames": the whole body equals the expected string built by hand (not via `formatEvent`, so the test pins the wire format): five `id: n\nevent: progress\ndata: {"percent":…,"step":"…"}\n\n` frames with `: ping\n\n` between them, then `event: done\ndata: {"lastId":5}\n\n`.
  - "sets the SSE headers": status 200, `content-type` starts with `text/event-stream`, `cache-control` contains `no-cache`, `x-accel-buffering` is `no`.
  - "`done` is last and ids increase 1..5".
  - "resumes after `?lastEventId=2`": first `id:` in the body is 3, three progress events then done.
  - "honours the `Last-Event-ID` header when there is no query param".
  - "ignores a garbage resume id" (`?lastEventId=abc` → starts at 1).
  - "stops emitting on abort": create an `AbortController`, call `GET(new Request(url, { signal }))`, read the first progress frame, `abort()`, advance timers by 5 s; the reader returns `done: true` and the collected text contains exactly one `event: progress` and no `event: done`; `vi.getTimerCount()` is 0.
  - **Negative check (required by the issue):** temporarily remove the abort listener in `createProgressStream`, run the test, confirm "stops emitting on abort" fails, restore it and confirm it passes. Record in the implementation report and PR body that this was tried and reverted.

### 6. The demo component

- `src/app/demos/SseProgressDemo.tsx`, `"use client"`, exporting `SseProgressDemo` (named export, as in the rest of the app). Invoke the `no-unnecessary-effects` skill before writing it.
  - State: `percent`, `events: { id: string; percent: number; step: string }[]`, `status: "idle" | "running" | "disconnected" | "done" | "error"`, `lastId: string | null`. `EventSource` kept in a `useRef`.
  - "Run demo" (disabled while running): if `status` is `done` or `idle`, reset events/percent and use no resume id; if `disconnected`, keep them and add a list line "Resumed after id N". Open `new EventSource(lastId ? "/api/demo/progress?lastEventId=" + lastId : "/api/demo/progress")`.
  - `progress` listener: `JSON.parse(event.data)`, set `percent`, append `{ id: event.lastEventId, ... }`, set `lastId`. `done` listener: close, `status = "done"`, `lastId = null`. `error` listener: if `readyState === EventSource.CLOSED` set `status = "error"`; otherwise leave it (the browser is reconnecting on its own, sending `Last-Event-ID`).
  - "Disconnect" (enabled only while running): `close()`, `status = "disconnected"`.
  - Close the source on unmount (the one legitimate effect: cleanup of an external connection).
  - Markup: a `role="progressbar"` with `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow`, `aria-label="Demo progress"`; the inner bar width `${percent}%` with `transition-[width] duration-300`; a status line with `aria-live="polite"`; an `<ol>` of received events showing `id N`, percent and step; two buttons. Style with the app's palette (`bg-shop-card`, `border-gray-300`, `text-sm`), full width, no fixed widths, so it fits at 390 px. Copy: plain, no em dashes, no emojis.
- `src/app/demos/SseProgressDemo.browser.test.tsx` with a `FakeEventSource` class installed via `vi.stubGlobal("EventSource", FakeEventSource)` that records every instance (`url`, `readyState`, `close` spy, listeners) and exposes `emit(type, data, lastEventId)` dispatching a `MessageEvent`:
  - "Run demo opens /api/demo/progress with no resume id".
  - "a progress event moves the bar and lists the event with its id" (`aria-valuenow` = 30, list shows `id 2`).
  - "done closes the source and shows the finished state".
  - "Disconnect closes the source; Run demo again opens `?lastEventId=<last id>` and keeps earlier events" (the reconnect the issue asks to show).
  - "after done, Run demo starts from scratch" (no query param, list cleared).
  - Wrap emits in `act` via `vitest-browser-react`'s render result or `await expect.element(...)`.

### 7. Commit code, capture SHA and PR number

- Run `yarn turbo run lint typecheck test --filter=./apps/patterns` and fix anything red.
- Commit route, helpers, component, tests and config (`feat(patterns): add sse progress demo route and component`), `git push`.
- `SHA=$(git rev-parse HEAD)`; confirm it is on the remote (`git ls-remote origin <branch>` shows it as the tip).
- `gh pr list --head <branch> --json number --jq '.[0].number'` gives this branch's PR number (the planning phase opened it). If it prints nothing, stop and report; do not guess a number.

### 8. Write `content/sse-route-handler.mdx`

- Frontmatter: `title: Server-Sent Events from a Route Handler`; `kind: atom`; one-sentence `summary` ending with `.` and no em dash (e.g. "The server must push a short run of progress or status updates to one open page, in order, without the page polling."); `tags: [sse, route-handler, streaming]`; `code:` two entries at `$SHA`: `apps/patterns/src/app/api/demo/progress/route.ts` (note: resume id from query or header, SSE headers, the stream bound to `request.signal`) and `apps/patterns/src/app/demos/SseProgressDemo.tsx` (note: `EventSource`, named events, Disconnect and resume by query param). Add `apps/patterns/src/lib/sse/progress-stream.ts` as a third entry if its excerpt is used in `## Pattern`, which it should be since the abort handling lives there. `verifiedIn: [<PR number>]`; `updated:` today's date.
- Directly after the frontmatter, before `## Problem`: `import { SseProgressDemo } from "@/app/demos/SseProgressDemo";`. If the build cannot resolve the alias from `.mdx`, register `SseProgressDemo` in `src/mdx-components.tsx` instead and drop the import; note which one was used in the PR.
- `## Problem`: a page waits on server work that takes seconds and advances in steps; polling is either slow or wasteful, a websocket is more than one-way updates need.
- `## Mechanism`, plain words, short sentences, covering each item from the issue: a stream is one long HTTP response the server keeps writing to; the frame format with `id:`, `event:`, `data:` and the blank line; the browser remembers the last id and sends it as `Last-Event-ID` on its own reconnect; an explicit `done` event, because a closed connection alone looks like a drop and `EventSource` would reconnect; a `: ping` comment every 15 s so proxies and load balancers do not close an idle connection; errors sent as events because the status line went out as 200 before the first byte of work; a bounded lifetime well under Vercel Fluid's 300 s limit, and one function instance held per open stream; `EventSource` for a plain GET, `fetch` plus `response.body.getReader()` when the request needs POST or custom headers; the producer polls or subscribes on the server, the browser never talks to the database. An H3 "Resuming by hand" explains why the demo passes `?lastEventId=`: `EventSource` sets the header only on its automatic reconnects, and a new `EventSource` after `close()` starts with none. An H3 "Try it" holding `<SseProgressDemo />` with one line telling the reader to press Disconnect mid-run, then Run demo again.
- `## Pattern`: `Excerpt from apps/patterns/src/app/api/demo/progress/route.ts, trimmed.` + the handler; `Excerpt from apps/patterns/src/lib/sse/progress-stream.ts, trimmed.` + the stream with abort handling; `Excerpt from apps/patterns/src/app/demos/SseProgressDemo.tsx, trimmed.` + the `EventSource` listeners. Every excerpt copied from the files at `$SHA`, trimmed, never invented.
- `## Pitfalls`: proxy buffering (`X-Accel-Buffering: no`, `no-transform`, no compression); errors after 200 must be events; browsers cap HTTP/1.1 at six connections per origin, so several tabs with streams can starve the page (HTTP/2 lifts it); function duration and one instance per stream; forgetting `request.signal` keeps timers or subscriptions running after the client left; no `done` event means endless reconnects.
- `## When not to use`: upload progress (use `XMLHttpRequest.upload.onprogress`); data that changes rarely (poll or revalidate); anonymous high-traffic pages (an instance per visitor).
- `## Code`: `<CodeLinks />` only.
- House voice, no em dashes, no emojis. Check with `grep -n "—" apps/patterns/content/sse-route-handler.mdx` (must print nothing).

### 9. Regenerate and verify

- `yarn workspace patterns index`; commit `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts` together with the doc (`feat(patterns): add sse-route-handler atom`).
- `yarn workspace patterns check-links` (network) to confirm the pinned links resolve on GitHub (requires the push from step 7).
- `yarn turbo run build --filter=./apps/patterns`: in the route table `/p/sse-route-handler` is prerendered and `/api/demo/progress` is `ƒ` (dynamic). If the page drops out of prerendering, the demo import is pulling request data into the page; fix, do not add config.
- Start the built app on a free port (`PORT=3014 yarn workspace patterns start` in the background), then `curl -N http://localhost:3014/api/demo/progress` prints the five frames with pings and `done` over about 2.5 s, and `curl -N "http://localhost:3014/api/demo/progress?lastEventId=3"` starts at `id: 4`. Stop the server. (There is no Vercel project for `apps/patterns` yet, so the issue's `curl` against a preview is replaced by this local check; say so in the PR.)
- Screenshots of `/p/sse-route-handler` mid-run at 1280 and 390 px are taken by the review phase.

### 10. Browser coverage decision

- No Playwright spec in `apps/website/e2e/`: the feature lives entirely in `apps/patterns`, which has no Playwright setup and is not served by the website's `test:integration` run. The component behaviour is covered by the new browser test, the route by the unit test, the page's prerendering by the build, and the visual check by the review phase's screenshots. No `e2e/*.md` journey either.

### 11. Run the Validation Commands

- Run every command in `Validation Commands` and fix anything that fails.

## Testing Strategy

### Unit Tests

- `frame.unit.test.ts`: exact frame strings for event/comment, optional id and event lines, JSON escaping keeps `data` on one line.
- `route.unit.test.ts`: the real `GET` read with a reader under fake timers: exact wire output, headers, id order, `done` last, resume by query param and by header, garbage resume id, abort stops emission and leaves no timers. Negative check on abort performed and reverted.
- `SseProgressDemo.browser.test.tsx`: fake `EventSource`; URL on first run, bar and list on progress, close on done, Disconnect then resume with `?lastEventId=`, fresh start after done.
- Existing `content.unit.test.ts` and `generated.unit.test.ts` cover the new doc's section order, `code.path` existence and generated-file freshness with no change.

### Test Coverage

- `apps/patterns/src/lib/sse/__tests__/frame.unit.test.ts` (`*.unit.test.ts`): catches a malformed SSE frame (missing blank line, multi-line `data`), which browsers silently drop.
- `apps/patterns/src/app/api/demo/progress/__tests__/route.unit.test.ts` (`*.unit.test.ts`): catches wrong frames, ids, order, missing `done`, broken resume, wrong headers, and a stream that keeps emitting after the client aborts. Fails today because the route does not exist.
- `apps/patterns/src/app/demos/SseProgressDemo.browser.test.tsx` (`*.browser.test.tsx`): catches the component not opening, not closing, or not resuming with the last id. Fails today because the component does not exist.
- The #189 content tests fail if the new doc breaks section order, links a missing file, or `INDEX.md`/manifest are stale.
- No Playwright spec: see step 10.

### Edge Cases

- Client aborts before the first event, mid-run, and after `done` (no double close throws).
- Reader `cancel()` without a signal abort still clears the timer.
- `lastEventId` of 0, 5 (only `done` is sent), 99, `-1`, `abc`, empty string.
- Both query param and header present: query param wins.
- Disconnect then Run demo twice in a row; Run demo after `done` resets.
- `error` event while `EventSource` is reconnecting (status stays running) vs. after it gave up (`CLOSED`, status error).
- Unmount while running closes the source.
- Doc at 390 px: bar and list stay within the column; code blocks scroll inside their own `pre`.

## Acceptance Criteria

- `apps/patterns/content/sse-route-handler.mdx` exists, `kind: atom`, sections exactly Problem, Mechanism, Pattern, Pitfalls, When not to use, Code; Mechanism covers every item listed in the issue, including why the demo resumes by query param; When not to use lists upload progress, rarely changing data, anonymous high-traffic pages.
- `code` entries point to the demo route and component (and the stream helper) at one 40-char SHA that exists on the remote; `verifiedIn` is this branch's PR number; every code excerpt matches its file at that SHA.
- `GET /api/demo/progress` emits `id: 1..5`, `event: progress`, `data: {"percent":n,"step":"..."}` at 10, 30, 70, 90, 100 about 500 ms apart, `: ping` between steps, then `event: done`, then closes; resumes after `?lastEventId=n` or `Last-Event-ID`; stops on abort; no env vars, no database.
- `/p/sse-route-handler` renders the demo: Run demo, a transitioning progress bar, a list of received events with ids, Disconnect, and a visible resume on the next run.
- `content/INDEX.md` and the manifest are regenerated and committed; the #189 tests pass.
- `/p/sse-route-handler` is prerendered in the build output; `/api/demo/progress` is dynamic.
- `apps/patterns/AGENTS.md` and README describe the demo exception to the no-client-components rule.
- No em dashes or emojis in any new prose or UI copy.
- Route abort test was shown to fail with abort handling removed, then restored.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `yarn workspace patterns index && git diff --exit-code apps/patterns/content/INDEX.md apps/patterns/src/lib/patterns/manifest.generated.ts` - Generated files are committed and fresh
- `grep -rn "—" apps/patterns/content/sse-route-handler.mdx apps/patterns/src/app/demos apps/patterns/src/lib/sse apps/patterns/src/app/api/demo` - Must print nothing (house copy rule)
- `yarn prettier --check .` - Formatting matches the repo config, so the commit hook will not reject it
- `yarn turbo run lint --filter=./apps/patterns` - Lint passes for the workspace
- `yarn turbo run typecheck --filter=./apps/patterns` - Types are sound for the workspace
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/patterns` - Unit (node) and browser (chromium) tests pass, including the #189 content tests
- `yarn turbo run build --filter=./apps/patterns` - Production build succeeds; `/p/sse-route-handler` prerendered, `/api/demo/progress` dynamic
- `yarn workspace patterns check-links` - Every pinned code link resolves on GitHub
- `PORT=3014 yarn workspace patterns start` (background), then `curl -N http://localhost:3014/api/demo/progress` - Prints five progress frames with pings and `done` over about 2.5 s; stop the server afterwards

## Notes

- New devDependencies in `apps/patterns` (via `yarn workspace patterns add -D`): `@vitejs/plugin-react`, `@vitest/browser-playwright`, `vitest-browser-react`, `playwright`, at the website's versions. CI already installs chromium through the website workspace; matching `playwright` versions means the patterns browser pool finds the same browser build. If CI ever fails with a missing browser for patterns, add a `yarn workspace patterns playwright install chromium` step rather than changing versions.
- The SHA pin is a two-commit dance: code first, pushed, then the doc pinned to that commit. The repo merges PRs with merge commits (see `8201dfb`), so the SHA survives the merge. Do not amend or rebase the code commit after the doc pins it.
- The PR is opened at the end of planning, so its number exists by the implement phase; read it with `gh pr list --head`, never predict it.
- No Vercel project exists for `apps/patterns` yet, so the issue's preview `curl` is done locally against `next start`. Once `ihas-patterns` is deployed, repeat it against the preview and check that no proxy buffers the stream.
- The demo's 2.5 s run is far inside any function limit; the doc's advice (bounded lifetime well under 300 s, 15 s heartbeat) is for the booking timeline.
- Out of scope: the booking confirmation stream and the `live-status-timeline` composite. When the booking timeline merges, add its route to this doc's `code` and its PR to `verifiedIn`.
- The document phase should add an `app_docs/feature-7c786f67-*.md` for this work and index it under the `apps/patterns` section of `docs/conditional-docs.md`.
