# Feature: patterns composite "Streamed per-request prefetch with live catch-up"

## Metadata

issue_number: `225`
adw_id: `ac4e9c74`
issue_json: `{"number":225,"title":"patterns: new composite \"Streamed per-request prefetch with live catch-up\"", ...}` (full body in the GitHub issue)

## Feature Description

A new composite pattern doc for `apps/patterns`, slug `streamed-prefetch-live-catch-up`, `kind: composite`. It describes how a live list is rendered so that the first paint is server-rendered and correct, and a live subscription then keeps it current. The production example is the list of active ADW runs in `SBub/adw-dashboard`.

The blocker named in the issue is cleared. `SBub/adw-dashboard` issue #104 closed on 2026-10-07 when **PR #111** merged into `develop`. Its merge commit is `4584304e8f3f1a68c4982d045d78966b440cdc85`, and that is the head of `develop` on origin (`git ls-remote https://github.com/SBub/adw-dashboard.git develop`). `gh pr view 111 -R SBub/adw-dashboard --json files` lists every file this plan links.

The code this doc points at lives in **another repository**. The patterns app currently assumes every `code[]` path and every `verifiedIn` PR belongs to `SBub/issebya-homes-ai-system`, in three places: `links.ts` hardcodes `REPO`, `check-code-links.ts` fetches through it, and `content.unit.test.ts` asserts that every `code[].path` exists on local disk. That is why `branch-protection.mdx` says the dashboard is "a separate repository and so not linked here". This feature adds a small, backwards-compatible extension for that case: an optional doc-level `repo` field in the frontmatter.

## User Story

As the owner of this repo, or a coding agent planning UI data flow in any Next app
I want one doc that shows how a constantly changing list is streamed per request, hydrated, then kept live with a catch-up read
So that I build live lists that are correct on first paint, never frozen into the static shell, and never miss the events that happen between the server read and the socket opening

## Problem Statement

The library has every atom this flow needs: server prefetch, live events into the query cache, the query error boundary, connection status, Suspense without the flash. It has no doc for how they combine around a list that must never be cached. Two failures are easy to hit here. A `"use cache"` scope or prerendered shell serves the build-time copy from the Resume Data Cache. And events that happen between the server read and the channel joining are lost. Separately, the patterns schema cannot link proof code that lives outside this repository.

## Solution Statement

1. Extend the frontmatter contract with an optional `repo` (`owner/name`). When it is absent, the default is `SBub/issebya-homes-ai-system`, so every existing doc is unchanged. `blobUrl`, `rawUrl` and `pullUrl` take the repo. `CodeLinks`, `RelationsPanel` and `check-code-links` pass the doc's repo. The local-disk existence test only runs for docs in this repo. For a foreign-repo doc, `check-links` (network, pinned SHA) is the proof that the file exists.
2. Write `content/streamed-prefetch-live-catch-up.mdx` with `repo: SBub/adw-dashboard`, every `code[].ref` pinned to `4584304e8f3f1a68c4982d045d78966b440cdc85`, and `verifiedIn: [111]`.
3. `uses` lists `server-prefetch-hydration`, `live-events-query-cache`, `query-error-boundary`, `connection-status` and `suspense-without-flash`. **`sse-route-handler` is dropped.** The live connection in PR #111 is a Supabase Realtime channel (`supabase.channel("adw").on("postgres_changes", ...)` in `src/data/realtime.ts`), which runs over a WebSocket, not Server-Sent Events. `revalidate-cached-section` is not listed. At most it is named in prose as the contrast case.
4. Regenerate `content/INDEX.md` and `manifest.generated.ts` with the generator.

## Relevant Files

Use these files to implement the feature:

- `AGENTS.md`, `.adw/project.md`: the repo rules (yarn only, conventional commits scoped `patterns`, no `Co-Authored-By`, no `--no-verify`).
- `apps/patterns/AGENTS.md`: the authoring rules this doc must follow (pinned SHAs, `### In this repo`, the 🔴 / ✅ pairs, titled fences, complete snippets, copy rules, never hand-edit generated files).
- `apps/patterns/README.md`: the frontmatter contract and section order. Document the new `repo` field here.
- `apps/patterns/src/lib/patterns/schema.ts`: the Zod frontmatter schema. Add the optional `repo`.
- `apps/patterns/src/lib/patterns/links.ts`: the GitHub URL builders. Make the repo a parameter with this repo as the default.
- `apps/patterns/src/app/ui/CodeLinks.tsx`: renders `## Code` from `code[]` through `blobUrl`. Needs the doc's repo.
- `apps/patterns/src/app/ui/RelationsPanel.tsx`: renders "Verified in" through `pullUrl`. Needs the doc's repo.
- The page that renders `CodeLinks` and `RelationsPanel` (under `apps/patterns/src/app/p/[slug]/`, or the MDX components map that provides `<CodeLinks />`). Thread `doc.repo` from there.
- `apps/patterns/scripts/check-code-links.ts`: the network link check. Must fetch each entry from its doc's repo.
- `apps/patterns/scripts/build-index.ts`, `apps/patterns/src/lib/patterns/manifest-source.ts`, `apps/patterns/src/lib/patterns/registry.ts`: the generator and registry. Check that `repo` flows through untouched (meta passes through the schema).
- `apps/patterns/src/lib/patterns/__tests__/schema.unit.test.ts`, `links.unit.test.ts`, `content.unit.test.ts`: the tests to extend.
- `apps/patterns/content/live-events-query-cache.mdx`: the atom whose mini app (`app/items/query.ts`, `apply-change.ts`, `realtime.ts`, `ItemList.tsx`, `page.tsx`, `app/providers.tsx`) this composite grows. Its identifiers must stay the same.
- `apps/patterns/content/server-prefetch-hydration.mdx`, `query-error-boundary.mdx`, `connection-status.mdx`, `suspense-without-flash.mdx`, `revalidate-cached-section.mdx`: the other atoms. Link them in Mechanism the way `infinite-scrolling.mdx` does (`[Title](/p/<slug>)`).
- `apps/patterns/content/infinite-scrolling.mdx`: the one existing composite. Model the structure, tone and Mechanism style on it.
- `apps/patterns/content/branch-protection.mdx`: its "not linked here" sentence explains why this extension is needed. Leave it as is.
- `apps/patterns/app_docs/feature-066a1da6-patterns-library-app.md`: from `docs/conditional-docs.md`. It covers how the app loads, validates and routes docs, and what to do when a doc fails the build or the index is stale.
- `docs/conditional-docs.md`: already points at `apps/patterns/content/INDEX.md`. No new entry is needed unless a new `app_docs` file is added.

Proof files in `SBub/adw-dashboard` at `4584304e8f3f1a68c4982d045d78966b440cdc85`. All of them are in PR #111's file list. Read each one with `gh api "repos/SBub/adw-dashboard/contents/<path>?ref=4584304e8f3f1a68c4982d045d78966b440cdc85" -H "Accept: application/vnd.github.raw"`:

- `src/data/active-runs-state.ts`: `getActiveRunsState = cache(async () => { await connection(); return prefetch(queryKeys.activeRuns, getActiveRuns); })`. Per request, not `"use cache"`. The doc comment explains the Resume Data Cache trap (issue #69) and the React `cache()` dedupe across the layout and page islands.
- `src/app/(dashboard)/layout.tsx`: the static shell. Header, the sidebar frame, the `ConnectionIndicator`, `<Providers>`. The sidebar's `SidebarActiveRuns` island sits under a `SectionBoundary` fallback, with its own `HydrationBoundary`. The project list next to it is `"use cache"`, which is the contrast.
- `src/app/(dashboard)/projects/page.tsx`: the `/projects` island `AllActiveRuns`. The static heading sits in the shell, and the list is the hole, with `HydrationBoundary` then `QueryBoundary` then `ActiveRunsOverview`.
- `src/app/providers.tsx`: the one browser `QueryClient`, and `useEffect(() => startRealtime(queryClient, ...), [...])` after hydration. The cleanup is the closer.
- `src/data/realtime.ts`: the channel. On `SUBSCRIBED` it calls `setConnectionStatus(Live)` and then `catchUp`, which re-reads `getActiveRuns()` and writes it with `setQueryData` unconditionally. Each event is folded with `current && applyRunChange(current, ev)`. The doc comment explains why the catch-up runs on every `SUBSCRIBED` (the first connect has the same gap) and why it uses `setQueryData` rather than invalidate or refetch (`staleTime: "static"` makes those a no-op).
- `src/data/active-runs-query.ts`: the one `queryOptions` (`queryKeys.activeRuns`, `staleTime: "static"`, `refetchOnMount: false`) that every reader spreads.
- `src/components/ActiveRunsView.tsx`: a per-project view through `select: (data) => activeRunsOf(data.active, projectId)`.
- `src/components/ActiveRunsOverview.tsx`: the all-projects view of the same entry.
- `src/lib/active-runs.ts`: `activeRunsOf`, `activeRunCounts`, `groupActiveRuns`, the pure slices behind each `select`.
- `src/data/apply-run-change.ts`: the pure reducer that patches the one entry.
- `src/data/hydration.test.ts`: proves that a re-hydrated older state never overwrites the live entry (equal or older `dataUpdatedAt`).

Pick 6 to 9 of these for `code[]`, each with a note of 160 characters or fewer.

### New Files

- `apps/patterns/content/streamed-prefetch-live-catch-up.mdx`: the doc.
- Regenerated, not hand-written: `apps/patterns/content/INDEX.md`, `apps/patterns/src/lib/patterns/manifest.generated.ts`.

## Implementation Plan

### Phase 1: Foundation

Add cross-repo code links to the patterns app. Add an optional, validated, doc-level `repo` field that defaults to this repo. Make the URL builders, the link check and the two rendering components respect it. Limit the local existence test to this repo's docs. Every existing doc must produce byte-identical links.

### Phase 2: Core Implementation

Write the MDX doc against the pinned dashboard files. Check every claim against those files.

### Phase 3: Integration

Regenerate the index and manifest. Run the unit tests, the build and the network link check. Document `repo` in the README and AGENTS.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Re-verify the pin before writing anything

- Run `git ls-remote https://github.com/SBub/adw-dashboard.git develop`. Confirm that `4584304e8f3f1a68c4982d045d78966b440cdc85` is still reachable on origin: it is the head of `develop`, or it is still listed as PR #111's `mergeCommit`.
- Run `gh pr view 111 -R SBub/adw-dashboard --json files,mergeCommit,state`. Confirm the state is `MERGED` and that every file you will put in `code[]` is in `files`.

### 2. Schema: optional `repo`

- In `schema.ts`, add `repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "repo must be owner/name").optional()` to `patternMetaSchema`. Write it as a flat character class with no nested quantifier, the same ReDoS reasoning as `kebabSchema`. Add one comment line: when `repo` is absent, the `code` paths and `verifiedIn` PRs are in this repository.
- Extend `schema.unit.test.ts`: `repo: "SBub/adw-dashboard"` parses; `"adw-dashboard"`, `"https://github.com/x/y"` and `"a/b/c"` are rejected; omitting `repo` still parses.

### 3. Links: repo as a parameter

- In `links.ts`, rename `REPO` to `DEFAULT_REPO` and export it if the content test needs it. Change the location type to `{ path: string; ref: string; repo?: string }`. `blobUrl` and `rawUrl` use `repo ?? DEFAULT_REPO`. `pullUrl(pr, repo = DEFAULT_REPO)`.
- Extend `links.unit.test.ts` with a blob URL, a raw URL and a pull URL built with `repo: "SBub/adw-dashboard"`. The three existing assertions must stay green unchanged.

### 4. Thread the repo through rendering and the link check

- `CodeLinks`: accept `repo?: string` and pass `{ ...entry, repo }` to `blobUrl`. `RelationsPanel`: pass the doc's `repo` to `pullUrl`. Find where both get their props (the `/p/[slug]` page and the MDX components map) and pass `doc.repo`.
- `scripts/check-code-links.ts`: flat-map to `{ ...entry, repo: doc.meta.repo }` so each fetch goes to the right repo. Print the repo in the log line only when it is not the default.
- `content.unit.test.ts`: restrict the "exists in the repo" `it.each` to docs whose `meta.repo` is absent (or equal to the default). Add one comment saying that `check-links` proves a foreign-repo path at its pinned SHA. Do not weaken the test for this repo's docs.

### 5. Write `apps/patterns/content/streamed-prefetch-live-catch-up.mdx`

Frontmatter:

- `title: Streamed per-request prefetch with live catch-up` (80 characters or fewer).
- `kind: composite`.
- `summary`: one "read when" sentence ending in a period, with no `. ` inside and no em dash, 200 characters or fewer. For example: `A list that changes constantly must be correct on first paint, streamed per request instead of cached, and then kept current by a live subscription that re-reads once when it opens.`
- `tags`: for example `react-query`, `realtime`, `streaming`, `suspense`, `rsc` (kebab-case).
- `repo: SBub/adw-dashboard`.
- `uses`: `server-prefetch-hydration`, `live-events-query-cache`, `query-error-boundary`, `connection-status`, `suspense-without-flash`. No `sse-route-handler`, no `revalidate-cached-section`.
- `code`: 6 to 9 entries from the proof list above, each with `ref: 4584304e8f3f1a68c4982d045d78966b440cdc85` and a note of 160 characters or fewer saying what that file proves.
- `verifiedIn: [111]`.
- `updated`: the day of the commit (`2026-10-07` if it lands today).

Sections, exactly in this order: `## Problem`, `## Mechanism`, `## Combines` (only `<Combines />`), `## Pattern`, `## Pitfalls`, `## When not to use`, `## Code` (only `<CodeLinks />`).

- **Problem**: a live list (for example, every active run) changes constantly. Cached, it is wrong. Fetched only on the client, it costs a placeholder and a round trip. Live without a catch-up, it misses the gap.
- **Mechanism**: the five flow steps from the issue, **in this order and unchanged in meaning**, as a numbered list. Keep their wording close to the issue's. Link each atom where it applies (`[Suspense without the flash](/p/suspense-without-flash)` for step 1, `[Server prefetch with hydration](/p/server-prefetch-hydration)` for steps 2 to 4, `[Live events into the query cache](/p/live-events-query-cache)` and `[Connection status with useSyncExternalStore](/p/connection-status)` for step 5, `[Suspended query with an error boundary](/p/query-error-boundary)` for the island's error state). Then three short subsections or paragraphs, as the issue asks:
  - **Why not cached.** Data that changes constantly must not sit inside `"use cache"` or the prerendered shell, because the Resume Data Cache serves the build-time copy. Await `connection()` before the read. Name `revalidate-cached-section` here at most, as the contrast case: it suits a section that is cached and changes rarely.
  - **One shared cache entry.** Per-view slices come from `select`, so the views cannot disagree, and an event never arrives before its entry exists (`current && reducer(current, ev)`).
  - **When client-only fetching is acceptable instead.** Operator views kept open for long sessions. The cost is a placeholder while the script loads, plus one round trip.
  - Check each claim against the pinned files. The catch-up runs on every `SUBSCRIBED` (first connect and reconnects), and it writes with `setQueryData` because `staleTime: "static"` makes invalidate and refetch a no-op. React `cache()` dedupes the one read across the layout and page islands within a request.
- **Pattern**: grow the `live-events-query-cache` atom's mini app with the same file names and identifiers (`app/items/query.ts`, `app/items/apply-change.ts`, `app/items/realtime.ts`, `app/items/ItemList.tsx`, `app/items/page.tsx`, `app/providers.tsx`). Read that atom's Pattern first. Show two or three complete files, the ones this composite changes, each in a titled fence:
  - `app/items/page.tsx`: a static heading in the shell, then a `<Suspense fallback>` around an async island that does `await connection()` (from `next/server`), prefetches with `makeQueryClient` and the query's fetcher, and renders `<HydrationBoundary state={dehydrate(client)}>` around the client list. No `"use cache"`.
  - `app/items/realtime.ts`: the subscription. When the connection reports it is open, it re-reads the full list once and writes it with `setQueryData`. Each event is patched with `current && applyChange(current, ev)`. It returns its closer.
  - `app/items/ItemList.tsx` (optional third): two views of the one entry through `select`.
  - Say in one sentence that the other files are the atom's, unchanged, with a link to `/p/live-events-query-cache`. Every file is complete: no `// ...`, no stubs, no repo constants, no product nouns (`items`, `runs` are fine; `adw`, `project_summaries` are not). Comment only the line that is the point. Use the prose rhythm from AGENTS.md (one sentence, the snippet, then one or two sentences on what is now true).
  - End with `### In this repo`. Open it with one sentence saying the production code is in `SBub/adw-dashboard`. Then give a prose list that maps each piece to `https://github.com/SBub/adw-dashboard/blob/4584304e8f3f1a68c4982d045d78966b440cdc85/<path>` (URL-encode `[` and `]` for any segment that has them). Every linked file must also be in `code[]`. No code fences.
- **Pitfalls**: symptom-first headings or items, for example: "A run that started after the deploy never shows until a reconnect" (a `"use cache"` read or no `connection()`); "A row that changed while the page loaded stays stale until its next event" (no catch-up on open); "The sidebar count and the list disagree" (two cache entries instead of one plus `select`); "An event creates a one-row list that looks complete" (no `current &&` guard); "The catch-up silently does nothing" (`invalidateQueries` on a `staleTime: "static"` query). Under `### Wrong and right`, give at least one 🔴 / ✅ pair of 5 to 10 lines each. Each half is titled with one of the Pattern's file names and has a sentence saying where in that file it sits. The obvious pair is `app/items/page.tsx` with `"use cache"` against `await connection()`.
- **When not to use**: data that changes rarely (cache it and revalidate by tag, see `revalidate-cached-section`); a list nobody needs live (plain server prefetch); a long-session operator view where client-only fetching is simpler.
- Copy rules: short sentences, no em dashes anywhere in the doc, no emojis other than the 🔴 / ✅ markers. Check with `grep -n "—" apps/patterns/content/streamed-prefetch-live-catch-up.mdx`, which must print nothing.

### 6. Regenerate

- `yarn workspace patterns index`. Commit the doc together with `content/INDEX.md` and `src/lib/patterns/manifest.generated.ts`. Never hand-edit either generated file.

### 7. Documentation of the `repo` field

- `apps/patterns/README.md`, Frontmatter block: add `repo: SBub/adw-dashboard # optional; where code and verifiedIn live; default this repo`. Add one sentence under "Add a doc" saying that a foreign-repo doc is proven by `check-links`, not the local existence test.
- `apps/patterns/AGENTS.md`: add one rule. When the proof code lives in another repository, set `repo` and pin to a SHA on _that_ repo's origin, and `verifiedIn` lists that repo's PR numbers.
- No `docs/conditional-docs.md` change. INDEX.md is already indexed there, and no new demo or `app_docs` file is added.

### 8. Browser coverage

- None, and none is warranted. `patterns` is marked "ADW may start: no" in the profile, so it has no E2E suite, and per the Review section it is reviewed from the diff and the build. The rendering change (the `href` repo) is covered by the `links` unit tests. The doc itself is covered by `content.unit.test.ts` (sections, titled fences) and the build (the registry validates at module scope).

### 9. Run the Validation Commands

Run every command below and fix anything that fails without weakening a rule or a test.

## Testing Strategy

### Unit Tests

- `schema.unit.test.ts`: the `repo` field accepts `owner/name`, rejects malformed values, and stays optional.
- `links.unit.test.ts`: `blobUrl`, `rawUrl` and `pullUrl` build URLs for an explicit repo. The existing default-repo assertions are unchanged.
- `content.unit.test.ts` (existing, now over the new doc too): the fixed composite sections, `<Combines />` and `<CodeLinks />` only, every Pattern fence titled, `uses` resolving to existing atoms (through `readContent` and `validateCollection`), and the local existence check skipped only for foreign-repo docs.
- `generated.unit.test.ts` (existing): fails if INDEX.md or the manifest is stale.

### Test Coverage

- `apps/patterns/src/lib/patterns/__tests__/links.unit.test.ts` (unit): a code link or "Verified in" link for a doc in another repo points at that repo. Today every link is hardcoded to `SBub/issebya-homes-ai-system`, so the new doc's links would 404 and nothing would catch it. Fails without the change, because `blobUrl` ignores `repo`.
- `apps/patterns/src/lib/patterns/__tests__/schema.unit.test.ts` (unit): a malformed `repo` is rejected at parse time instead of producing broken URLs. Fails without the change, because the field does not exist.
- The doc itself needs no new test of its own. The existing `content.unit.test.ts` cases are parameterised over every doc, so they pick it up automatically. Its cross-repo existence is proven by `yarn workspace patterns check-links`, a network script that is deliberately kept out of `test`.

### Edge Cases

- A doc without `repo`: links byte-identical to today. The 12 existing docs must render and check exactly as before.
- Paths with `(dashboard)` and `[owner]/[repo]` segments: `encodePath` keeps `(` and `)` and encodes `[` and `]`. Apply the same encoding to the hand-written `### In this repo` URLs.
- `repo` given but `code[].path` absent on that repo at the SHA: `check-links` must exit 1.
- `verifiedIn: [111]` on this repo would point at an unrelated PR. The `RelationsPanel` change prevents that.
- `updated` must be a real calendar day. The summary must not contain `. `.

## Acceptance Criteria

- `apps/patterns/content/streamed-prefetch-live-catch-up.mdx` exists with `kind: composite`, `repo: SBub/adw-dashboard`, `uses` exactly the five atoms above (no `sse-route-handler`, no `revalidate-cached-section`), every `code[].ref` equal to `4584304e8f3f1a68c4982d045d78966b440cdc85`, every `code[].path` in PR #111's file list, and `verifiedIn: [111]`.
- The doc has exactly the composite H2s in order. `## Combines` and `## Code` hold only their tags.
- The five flow steps appear in `## Mechanism` in order and unchanged in meaning. "Why not cached", "one shared cache entry" and "when client-only fetching is acceptable" are each covered.
- `## Pattern` is complete titled files on `app/...` paths with domain-neutral names, ending in an `### In this repo` prose list with links to `SBub/adw-dashboard` at the same SHA.
- Pitfalls are symptom-first, with at least one 🔴 / ✅ pair under `### Wrong and right`. No em dash anywhere in the doc.
- `content/INDEX.md` and `manifest.generated.ts` are regenerated and committed.
- On `/p/streamed-prefetch-live-catch-up`, the Code links and the "Verified in" link point at `github.com/SBub/adw-dashboard`. Every other doc's links are unchanged.
- `yarn workspace patterns test`, the build and `yarn workspace patterns check-links` pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `git ls-remote https://github.com/SBub/adw-dashboard.git develop`: the pinned SHA is still on origin.
- `gh pr view 111 -R SBub/adw-dashboard --json files,state`: `MERGED`, and every `code[].path` is listed.
- `yarn workspace patterns index`: regenerates INDEX.md and the manifest. `git status` must then show no further change after a second run.
- `grep -n "—" apps/patterns/content/streamed-prefetch-live-catch-up.mdx`: must print nothing (copy rule).
- `yarn turbo run typecheck --filter=./apps/patterns`: the type changes to `links.ts`, `CodeLinks` and `RelationsPanel`.
- `yarn turbo run lint --filter=./apps/patterns`: lint, including `security/detect-unsafe-regex` on the new `repo` regex.
- `yarn prettier --check .`: format.
- `yarn knip`: no dead export (for example, an unused `DEFAULT_REPO` export).
- `yarn turbo run test --filter=./apps/patterns`: unit tests (schema, links, content, generated) green, including the new doc. This is the test the issue's acceptance names (`yarn workspace patterns test`).
- `yarn turbo run build --filter=./apps/patterns`: the registry validates at module scope and every page prerenders.
- `yarn workspace patterns check-links`: every code link of every doc returns 200, including the nine or fewer `SBub/adw-dashboard` links at the pinned SHA.

## Notes

- No new dependency.
- The issue's "No `Co-Authored-By` trailer" matches the repo rule and wins over any default attribution. Commit scope `patterns`, for example `feat(patterns): add streamed-prefetch-live-catch-up composite and cross-repo code links`.
- The `sse-route-handler` decision is based on the pinned code: `src/data/realtime.ts` uses `@supabase/supabase-js` Realtime (`postgres_changes`), so the transport is a WebSocket. If a reviewer wants SSE named, it belongs in prose as an alternative transport, not in `uses`.
- The connection indicator file itself (`src/components/ConnectionIndicator.tsx`) is not in PR #111's file list. Do not add it to `code[]`, because `verifiedIn` must touch every linked file. `realtime.ts` (the one writer of the status) is in the list, and it covers the connection-status claim.
- The doc is pinned to the merge commit, not a branch. If `develop` moves later, the SHA stays valid because it is in `develop`'s history.
- A natural follow-up, out of scope here: `branch-protection.mdx` could now link the dashboard's rulesets through `repo`.
