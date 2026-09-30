# SSE Route Handler atom with a live progress demo

**ADW ID:** 7c786f67
**Date:** 2026-09-29
**Specification:** specs/issue-194-adw-7c786f67-sdlc_planner-sse-route-handler-atom.md

## Overview

Adds the `sse-route-handler` atom doc to the patterns library, plus a live demo in the same app: a real Route Handler that streams Server-Sent Events and a client component that consumes it inside `/p/sse-route-handler`. It documents the pattern the website's live booking confirmation timeline (sibling issue) will follow, before it is used there.

## What Was Built

- `content/sse-route-handler.mdx`: the atom doc (frame format, `Last-Event-ID` resume, explicit `done` event, `: ping` heartbeat, errors as events after a 200, abort handling, function duration cost), with the demo rendered inline.
- `GET /api/demo/progress`: emits five `progress` events about 500 ms apart, a `: ping` comment between them, then a `done` event. No env vars, no database.
- `SseProgressDemo`: the app's first client component. "Run demo" opens an `EventSource`, a progress bar fills, received events are listed with their ids, "Disconnect" closes the stream, and running again resumes after the last id.
- A Vitest browser pool (chromium) for `apps/patterns`, so the demo can be tested with a fake `EventSource`.
- An amended app rule: client components are allowed, but only as live demos under `src/app/demos/`.

## Technical Implementation

### Files Modified

- `apps/patterns/src/lib/sse/frame.ts`: `formatEvent` (`id:`/`event:`/`data:` lines plus a blank line, data JSON-encoded so it is always one line) and `formatComment`.
- `apps/patterns/src/lib/sse/progress-stream.ts`: `SSE_HEADERS`, `parseResumeId`, `createProgressStream({ fromId, delayMs, signal })`.
- `apps/patterns/src/app/api/demo/progress/route.ts`: thin `GET` wiring the resume id and `request.signal` into the stream.
- `apps/patterns/src/app/demos/SseProgressDemo.tsx`: the `"use client"` demo.
- `apps/patterns/content/sse-route-handler.mdx`: the doc, code links pinned to commit `71869c9`, `verifiedIn: [196]`.
- `apps/patterns/content/INDEX.md`, `src/lib/patterns/manifest.generated.ts`: regenerated.
- `apps/patterns/vitest.config.ts`, `package.json`, `knip.json`: browser pool (`@vitejs/plugin-react`, `@vitest/browser-playwright`, `vitest-browser-react`, `playwright`, same ranges as `apps/website`).
- `apps/patterns/AGENTS.md`, `README.md`: demo exception to the "no client components" rule; demo routes take no env vars or database; never `export const dynamic`.
- Tests: `frame.unit.test.ts`, `api/demo/progress/__tests__/route.unit.test.ts`, `SseProgressDemo.browser.test.tsx`.

### Key Changes

- Stream logic lives in `src/lib/sse/`, not in `route.ts`, because Next allows only HTTP-method and segment-config exports from a route file and the tests need the helpers.
- Resume: the route reads `?lastEventId=` first, then the `Last-Event-ID` header. `EventSource` sends the header only on its own automatic reconnect; after a manual `close()` a new source starts clean, so the demo passes the last id as a query param. Anything that is not a non-negative integer resumes from 0.
- Abort: the stream listens on `request.signal` and clears its timer on abort or reader cancel, so nothing runs after the client leaves.
- Headers include `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, so compressing or buffering proxies do not hold events until the response ends.
- The doc page stays prerendered; the demo is a client island and `/api/demo/progress` is the only dynamic route. No `export const dynamic` (rejected under `cacheComponents`); reading `request` makes the handler dynamic.

## How to Use

1. `yarn workspace patterns dev` (defaults to port 3004, honours `PORT`).
2. Open `/p/sse-route-handler` and click "Run demo".
3. Click "Disconnect" mid-run, then "Run demo" again: the list shows "Resumed after id N" and continues from there.
4. From a terminal: `curl -N http://localhost:3004/api/demo/progress` shows the raw frames; add `?lastEventId=3` to resume.

## Configuration

None. The demo route uses no env vars and no database. CI's existing `playwright install chromium` (via the website workspace) serves the new browser pool as long as the `playwright` version ranges stay matched.

## Testing

- `yarn workspace patterns test` runs both pools: node (frames, route response read with a reader, abort stops the stream, content and generated-file checks) and browser (demo with a fake `EventSource`).
- `yarn workspace patterns build` should list `/p/sse-route-handler` as prerendered and `/api/demo/progress` as dynamic (`ƒ`).

## Notes

- Real use pings every 15 s while waiting on work; the demo pings between steps because its whole run is 2.5 s.
- Each open stream holds one function instance for its duration; keep streams short and bounded.
- A new demo follows the same shape: one file under `src/app/demos/`, fetching only from `src/app/api/demo/*`, plus a browser test.
