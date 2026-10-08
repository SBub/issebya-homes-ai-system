# Feature: patterns composite "Streamed per-request prefetch with live catch-up"

## Metadata

issue_number: `225`
adw_id: `b50794d3`
issue_json: `{"number":225,"title":"patterns: new composite \"Streamed per-request prefetch with live catch-up\"", ...}` (full body in the GitHub issue)

## Feature Description

A new composite pattern doc for `apps/patterns`, slug `streamed-prefetch-live-catch-up`, `kind: composite`. It describes how a live list (the production example is "all active ADW runs" in SBub/adw-dashboard) renders so that the first paint is server-rendered and correct, then stays current through a live subscription. It combines existing atoms: server prefetch with hydration, live events into the query cache, a suspended query with an error boundary, connection status with useSyncExternalStore, and Suspense without the flash.

The production code that proves the pattern lives in a different repository, SBub/adw-dashboard (issue #104, "Active runs: one shared cache entry, shown on /projects and filtered per project"). The patterns app today hardcodes `SBub/issebya-homes-ai-system` as the only GitHub repo for code links and `verifiedIn` pull request links, and its content test asserts every `code[].path` exists in this checkout. So this feature also adds a small, doc-level `repo` field to the frontmatter contract so a doc can point at the dashboard.

## User Story

As the owner (and as a coding agent reading `content/INDEX.md`)
I want a single doc that explains how a per-request, streamed, uncached server prefetch hands off to a live subscription with a catch-up re-read
So that the next live list I build gets a correct first paint, no duplicate fetch, no stale prerendered copy and no gap between the server read and the first live event.

## Problem Statement

The atoms exist separately, but nothing explains how they fit together for a list that changes constantly: why the read must not be cached or prerendered, why there is exactly one shared cache entry, and why the client re-reads once when the subscription opens. The production implementation (#104) is in another repository that the patterns schema and link builders cannot reference.

## Solution Statement

1. Gate on SBub/adw-dashboard #104 being merged. If it is not merged, stop without writing the doc.
2. Extend the frontmatter contract with an optional doc-level `repo`, restricted to a known set (`SBub/issebya-homes-ai-system` default, `SBub/adw-dashboard`). Link builders (`blobUrl`, `rawUrl`, `pullUrl`) take the repo; `CodeLinks`, `RelationsPanel` and `check-code-links.ts` pass it through; the content test only asserts local file existence for docs on the default repo (the external ones are proven by `check-links`).
3. Write `content/streamed-prefetch-live-catch-up.mdx` following the composite skeleton, with the five flow steps verbatim in meaning, a runnable two-or-three-file mini app, symptom-first pitfalls with a 🔴 / ✅ pair, and every `code[]` entry pinned to a 40-character SHA on SBub/adw-dashboard origin, `verifiedIn` naming the #104 PR.
4. Regenerate `content/INDEX.md` and `manifest.generated.ts` with `yarn workspace patterns index`.

Doc-level rather than per-entry `repo`: `verifiedIn` PR numbers also belong to one repository, and a per-entry repo would leave `verifiedIn` ambiguous. An enum rather than a free string keeps arbitrary hosts out of rendered links.

## Relevant Files

- `AGENTS.md` (root) - repo conventions: yarn only, conventional commits, no `Co-Authored-By`.
- `.adw/project.md` - profile: `patterns` is never started by ADW; reviewed from the diff and the build; commands and filter form.
- `docs/conditional-docs.md` - `## apps/patterns` section; points at `apps/patterns/README.md` (frontmatter contract change applies) and `content/INDEX.md`.
- `apps/patterns/AGENTS.md` - the doc-writing rules (SHA pinning, Pattern snippet style, titled fences, `### In this repo`, 🔴 / ✅ pairs, copy rules, regenerate never hand-edit).
- `apps/patterns/README.md` - frontmatter contract and section skeleton; must document the new `repo` field.
- `apps/patterns/app_docs/feature-066a1da6-patterns-library-app.md` - how the registry, generated manifest and validation work (conditional-docs: changing how docs are validated).
- `apps/patterns/src/lib/patterns/schema.ts` - Zod frontmatter schema; add `repo`.
- `apps/patterns/src/lib/patterns/links.ts` - hardcoded `REPO`; make the repo a parameter with the default.
- `apps/patterns/src/app/ui/CodeLinks.tsx` - renders `## Code` links via `blobUrl`; needs the doc's repo.
- `apps/patterns/src/app/ui/RelationsPanel.tsx` - renders `verifiedIn` via `pullUrl`; needs the doc's repo.
- `apps/patterns/src/app/p/[slug]/page.tsx` - wires `<CodeLinks code={pattern.code} />`; pass the repo.
- `apps/patterns/scripts/check-code-links.ts` - fetches `rawUrl(entry)`; must use the doc's repo.
- `apps/patterns/src/lib/patterns/__tests__/schema.unit.test.ts` - add `repo` acceptance/rejection cases.
- `apps/patterns/src/lib/patterns/__tests__/links.unit.test.ts` - add cases for the dashboard repo.
- `apps/patterns/src/lib/patterns/__tests__/content.unit.test.ts` - restrict the `existsSync` check to docs on the default repo.
- `apps/patterns/src/lib/patterns/sections.ts` - section checker the new doc must satisfy (read only).
- `apps/patterns/content/infinite-scrolling.mdx` - the one existing composite; model for structure and tone.
- `apps/patterns/content/server-prefetch-hydration.mdx`, `live-events-query-cache.mdx`, `query-error-boundary.mdx`, `connection-status.mdx`, `suspense-without-flash.mdx`, `sse-route-handler.mdx`, `revalidate-cached-section.mdx` - the atoms; read to keep identifiers and claims consistent and to link with `/p/<slug>` in prose.
- `apps/patterns/content/INDEX.md`, `apps/patterns/src/lib/patterns/manifest.generated.ts` - generated; regenerated, never hand-edited.

External, read at the pinned SHA (via `gh api` / `git show` on a clone, never by editing): SBub/adw-dashboard `src/app/(dashboard)/layout.tsx`, `src/data/index.ts`, `src/data/query-keys.ts` (and wherever `activeRunsQuery` lives), `src/data/realtime.ts`, the providers component in the dashboard layout, `src/app/(dashboard)/projects/page.tsx`, `ActiveRunsView`, `ProjectNav`, and the connection-status store if one exists. The exact paths come from `gh pr view <n> -R SBub/adw-dashboard --json files`.

### New Files

- `apps/patterns/content/streamed-prefetch-live-catch-up.mdx` - the composite doc.

## Implementation Plan

### Phase 1: Foundation

Confirm #104 is merged and collect the pinned SHA and file list. Add the doc-level `repo` field to the schema, link builders, components, link checker and tests, so an external-repo doc validates, renders correct links and passes the content test.

### Phase 2: Core Implementation

Write the MDX doc against the merged dashboard code at its pinned SHA: frontmatter, Problem, Mechanism (the five-step flow plus the three "also cover" points), Combines, Pattern (runnable mini app plus `### Wrong and right` and `### In this repo`), Pitfalls, When not to use, Code.

### Phase 3: Integration

Regenerate the index and manifest, update the README frontmatter contract, run `check-links` against GitHub, and run the profile's gates scoped to `./apps/patterns`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Gate: confirm SBub/adw-dashboard #104 has merged

- `gh issue view 104 -R SBub/adw-dashboard --json state,closedByPullRequestsReferences` and `gh pr list -R SBub/adw-dashboard --state merged --search "104 in:title"` to find the PR that implements #104. At planning time (2026-10-06) the issue is OPEN and no PR exists.
- If no merged PR exists: stop. Do not create the doc, do not change the schema. Report "blocked on SBub/adw-dashboard#104" as the outcome. The issue explicitly forbids writing the pattern before #104 merges.
- If merged: record the PR number `<pr>` and its merge commit. Pin `ref` to a SHA that is on origin's `develop` (`git ls-remote https://github.com/SBub/adw-dashboard develop`) and contains the PR's changes, e.g. the merge commit or the current develop head. Verify with `gh api repos/SBub/adw-dashboard/commits/<sha>` that it exists.
- `gh pr view <pr> -R SBub/adw-dashboard --json files` and record the files it touched. Every `code[].path` must be in that list.

### 2. Read the merged implementation at the pinned SHA

- Fetch each file at `<sha>` (`gh api "repos/SBub/adw-dashboard/contents/<path>?ref=<sha>" -q .content | base64 -d`, or a shallow clone in the scratchpad, never inside this repo).
- Confirm each fact the doc will state: the layout prefetch inside its own Suspense and HydrationBoundary; `await connection()` before the read and no `"use cache"` around it; one query key for active runs; per-view `select` (per-project filter, sidebar counts); the providers component opening the realtime channel in an effect; the catch-up re-read of the active entry on SUBSCRIBED; events patching that one entry.
- Decide on `sse-route-handler` in `uses`: the #104 design uses a Supabase realtime channel (`SUBSCRIBED`), not Server-Sent Events. If the merged code confirms that, drop `sse-route-handler`. Include it only if the live connection is actually an `EventSource`.
- Check whether the merged code reads connection status with `useSyncExternalStore`. `connection-status` stays in `uses` per the issue; if the dashboard does not render a status, the doc's Mechanism says the status is what triggers catch-up (the "connection reports it is open" event) and cites the atom for showing it.

### 3. Add a doc-level `repo` to the frontmatter schema

- In `schema.ts`, add `repo: z.enum(["SBub/issebya-homes-ai-system", "SBub/adw-dashboard"]).default("SBub/issebya-homes-ai-system")` to `patternMetaSchema`, with a short comment: the repository every `code` path and `verifiedIn` number refers to. Export a `DEFAULT_REPO` constant (or the enum's first value) so `links.ts` and tests share it. `PatternMeta` then always carries `repo`.
- In `schema.unit.test.ts`: a doc without `repo` parses with the default; `repo: SBub/adw-dashboard` is accepted; an unknown repo (`someone/else`) and a URL are rejected.

### 4. Make the link builders repo-aware

- In `links.ts`, drop the module `REPO` constant for a parameter: `blobUrl({ repo, path, ref })`, `rawUrl({ repo, path, ref })`, `pullUrl(repo, pr)`. Keep per-segment encoding unchanged.
- Update `links.unit.test.ts`: existing cases pass `repo: "SBub/issebya-homes-ai-system"` and keep their expected URLs; add one blob, one raw and one pull URL case for `SBub/adw-dashboard`.

### 5. Pass the repo through the UI and the link checker

- `CodeLinks.tsx`: accept `repo` alongside `code` and call `blobUrl({ repo, ...entry })`.
- `src/app/p/[slug]/page.tsx`: `CodeLinks: () => <CodeLinks repo={pattern.repo} code={pattern.code} />`.
- `RelationsPanel.tsx`: `pullUrl(pattern.repo, pr)`. Where the panel lists code paths, show the repo name once above the list when it is not the default, so a reader is not misled into looking in this repo.
- `scripts/check-code-links.ts`: iterate docs and fetch `rawUrl({ repo: doc.meta.repo, ...entry })`; include the repo in the log line for non-default repos.

### 6. Restrict the local existence check to this repo

- In `content.unit.test.ts`, build the `existsSync` cases only from docs whose `meta.repo` is the default. Add a one-line comment: other repos are proven by `check-links`, which fetches each file at its pinned SHA.
- Do not weaken the check for this repo's docs.

### 7. Write `content/streamed-prefetch-live-catch-up.mdx`

Frontmatter:

- `title: Streamed per-request prefetch with live catch-up` (under 80 chars).
- `kind: composite`, `repo: SBub/adw-dashboard`.
- `summary`: one sentence, ending with a period, no em dash, as a "read when" line, e.g. "A list that changes constantly must be correct at first paint from a per-request server read, then stay current from a live subscription with no gap between the two."
- `tags`: kebab-case, e.g. `realtime`, `rsc`, `streaming`, `react-query`.
- `uses`: `server-prefetch-hydration`, `live-events-query-cache`, `query-error-boundary`, `connection-status`, `suspense-without-flash`, plus `sse-route-handler` only per step 2. Never `revalidate-cached-section`.
- `code`: one entry per proving file from step 1 (layout prefetch, the all-projects read with `connection()`, the query key / `activeRunsQuery`, the realtime listener with `applyRunEvent` and `catchUp`, the providers component, one `select` reader such as `ActiveRunsView` or `ProjectNav`), each with the 40-char `ref` and a `note` of 1 to 160 chars stating what that file proves.
- `verifiedIn: [<pr>]` (the PR number, not 104 unless the PR really is 104), `updated: <today, YYYY-MM-DD>`.

Sections, exactly these H2s in order: Problem, Mechanism, Combines, Pattern, Pitfalls, When not to use, Code.

- `## Problem`: a live list needs a correct first paint and must stay current; caching it serves a stale copy, client-only fetching costs a placeholder and a round trip, and a subscription opened after the server read misses what changed in between.
- `## Mechanism`: the five flow steps from the issue as a numbered list, in order and unchanged in meaning (request and static shell with the Suspense fallback; per-request uncached prefetch inside the boundary; streamed chunk with the list HTML and the prefetched data, no second request; hydration from the seeded cache with no fetch; the providers component opens the subscription after hydration, re-reads once when it reports open, then each event patches the entry). Link the atoms in prose (`/p/<slug>`). Then three short paragraphs: **Why not cached** (`"use cache"` and the prerendered shell serve the build-time copy from the Resume Data Cache; await `connection()` before the read; `revalidate-cached-section` named only as the contrast case for data that is cached), **One shared cache entry** (per-view slices via `select`, so views cannot disagree and an event never arrives before its entry exists), **When client-only fetching is acceptable** (operator views kept open for long sessions; costs a placeholder while the script loads plus one round trip).
- `## Combines`: only `<Combines />`.
- `## Pattern`: one sentence, then a runnable mini app of two or three files in the react.dev teaching style, App Router paths, every fence titled, complete files, domain-neutral names (`items`, `events`), platform-real APIs. Suggested set: `app/items/page.tsx` (static shell, Suspense, a server component that awaits `connection()` then prefetches into a `QueryClient` and renders `HydrationBoundary`), `app/items/ItemList.tsx` (`"use client"`, `useSuspenseQuery` with `refetchOnMount: false`, plus a `select`ed count view), and `app/items/live.ts` or a providers file (opens an `EventSource` or a timer-driven in-file event source outside React after hydration, re-reads once on open via `queryClient.fetchQuery`, then `setQueryData` per event). If a route is needed for the source, it is a tiny in-file one, and the set stays at three files where possible; reuse `app/providers.tsx` from [Server prefetch with hydration](/p/server-prefetch-hydration) unchanged, as `infinite-scrolling` does. No repo constants, no product nouns ("runs", "projects", "ADW"), no casts, no styling, no aria. Comment only the line that is the point. One or two sentences after each snippet saying what is now true.
- `### Wrong and right` (inside Pattern): at least one 🔴 / ✅ pair, symptom first, 5 to 10 lines each, same `title="..."` as the file it belongs to, with a sentence saying where it sits. Primary pair: the list shows a build-time copy after deploy (🔴 the read inside `"use cache"` / no `connection()`; ✅ `await connection()` then read). Optional second pair: an event lands before the entry exists and is dropped (🔴 per-view entries patched by slug; ✅ one entry, views `select`).
- `### In this repo`: prose list, no code fences, each item a link `https://github.com/SBub/adw-dashboard/blob/<sha>/<path>` at the same SHA as its `code[]` entry, mapping each mini-app piece to the dashboard file and the function names that do it. Every claim checked against the file at that SHA.
- `## Pitfalls`: symptom-first bullets: list frozen at the build-time copy; event dropped because the cache entry did not exist yet (#69 shape); two views disagree about the same row; a change between the server read and SUBSCRIBED never shows (no catch-up); duplicate fetch on hydration (`refetchOnMount` / mismatched keys); the subscription opened inside a view component and closed on navigation instead of in the providers.
- `## When not to use`: data that rarely changes (cache it, contrast with `revalidate-cached-section`); long-lived operator views where client-only fetching is fine; a list nobody needs on first paint.
- `## Code`: only `<CodeLinks />`.
- Copy rules: short sentences, no em dashes anywhere in the doc, no emojis except the two pair markers.

### 8. Document the `repo` field

- `apps/patterns/README.md`: add `repo: SBub/adw-dashboard # optional; defaults to this repo; code paths and verifiedIn refer to it` to the frontmatter block, and one sentence under "Add a doc" that `check-links` is the only existence check for another repo's files.
- `apps/patterns/AGENTS.md`: one rule line: a doc whose proof lives in another repo sets `repo`, and its `SHA must exist on that repo's origin`; adding a repo means adding it to the enum in `schema.ts`.

### 9. Regenerate and check links

- `yarn workspace patterns index`, then confirm `content/INDEX.md` lists the new doc under `## Composites` and `manifest.generated.ts` imports it.
- `yarn workspace patterns check-links` (network). Every entry, including the dashboard ones, must return 200.
- `gh pr view <pr> -R SBub/adw-dashboard --json files` once more against the final `code[].path` list.

### 10. Browser coverage

- None via E2E: `patterns` is not started by ADW and has no Playwright suite (profile: reviewed from the diff and the build). The doc has no live demo, so no browser test is added. The reviewer reads the diff and confirms `next build` prerenders `/p/streamed-prefetch-live-catch-up`.

### 11. Run the Validation Commands

## Testing Strategy

### Unit Tests

- `schema.unit.test.ts`: `repo` defaults to this repo; `SBub/adw-dashboard` accepted; unknown repo rejected.
- `links.unit.test.ts`: blob, raw and pull URLs for both repos.
- `content.unit.test.ts` (existing, over real content): the new doc passes `checkSections` for a composite, labels every Pattern fence, and `readContent()`/`validateCollection` accept its `uses`. The `existsSync` case now skips external-repo docs.
- `generated.unit.test.ts` (existing): fails if `INDEX.md` or the manifest is stale after adding the doc.

### Test Coverage

- `src/lib/patterns/__tests__/schema.unit.test.ts` (unit, `*.unit.test.ts`): rejects an unknown `repo` and defaults a missing one. Fails without this change because the schema has no `repo` field (Zod strips unknown keys, so `meta.repo` is undefined).
- `src/lib/patterns/__tests__/links.unit.test.ts` (unit): the dashboard blob/raw/pull URLs. Fails without this change because every URL is built against the hardcoded repo; nothing currently catches a code link pointing at the wrong repository.
- The doc itself is covered by the existing `content.unit.test.ts` and `generated.unit.test.ts` cases, which are parameterised over `content/` and so gain cases for the new slug automatically. No new test file is needed for the prose.

### Edge Cases

- #104 not merged at implementation time: stop, write nothing.
- The pinned SHA is on a feature branch that was later deleted: pin a SHA on `develop` so it stays reachable.
- `verifiedIn` mistakenly set to issue 104 instead of the PR number.
- A file the doc cites was renamed in the PR (path in `code[]` must match the PR's file list at the SHA).
- Live connection is not SSE: `sse-route-handler` must not be in `uses`.
- An em dash slipping into the summary (schema rejects) or into the body (no automatic check; grep for `—` in the new file before commit).
- Docs on the default repo must still fail the content test when a path does not exist locally.

## Acceptance Criteria

- `apps/patterns/content/streamed-prefetch-live-catch-up.mdx` exists with `kind: composite`, `repo: SBub/adw-dashboard`, the listed `uses` (no `revalidate-cached-section`; `sse-route-handler` only if the live connection is SSE), and the seven H2s in order.
- The five flow steps appear in `## Mechanism` in order and unchanged in meaning; "Why not cached", "One shared cache entry" and "When client-only fetching is acceptable" are covered briefly.
- Every `code[].ref` is a 40-character SHA that exists on SBub/adw-dashboard origin and is reachable from `develop`; every `code[].path` is in `gh pr view <pr> --json files`; `verifiedIn` lists the #104 PR number.
- `## Pattern` is a runnable two-or-three-file mini app with titled fences, a 🔴 / ✅ pair under `### Wrong and right`, and an `### In this repo` list linking each piece at the same SHA.
- No em dashes and no emojis other than the pair markers in the doc.
- On `/p/streamed-prefetch-live-catch-up`, code links and the Verified in link point at `github.com/SBub/adw-dashboard`; every existing doc's links are unchanged.
- `content/INDEX.md` and `manifest.generated.ts` regenerated and committed; `yarn workspace patterns check-links` returns 200 for every entry.
- `yarn workspace patterns test` and every validation command below pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `gh pr view <pr> -R SBub/adw-dashboard --json state,mergedAt,files` - #104's PR is MERGED and touches every `code[].path`.
- `git ls-remote https://github.com/SBub/adw-dashboard develop` and `gh api repos/SBub/adw-dashboard/commits/<sha> -q .sha` - the pinned SHA exists on origin.
- `yarn workspace patterns index` - regenerates INDEX.md and the manifest; `git diff --exit-code apps/patterns/content/INDEX.md apps/patterns/src/lib/patterns/manifest.generated.ts` afterwards shows nothing uncommitted.
- `yarn workspace patterns check-links` - every code link, including the dashboard ones, resolves on GitHub (network).
- `grep -n "—" apps/patterns/content/streamed-prefetch-live-catch-up.mdx` - must print nothing (house copy rule).
- `yarn turbo run typecheck --filter=./apps/patterns` - types after the `repo` field and link signature change.
- `yarn turbo run lint --filter=./apps/patterns` - lint.
- `yarn prettier --check .` - format.
- `yarn knip` - dead code (whole repo); catches an unused export such as a leftover `REPO`.
- `yarn turbo run test --filter=./apps/patterns` - unit and browser projects, including content, generated, schema and links tests.
- `yarn turbo run build --filter=./apps/patterns` - prebuild runs `index`, the registry validates every doc at module scope, and `/p/streamed-prefetch-live-catch-up` prerenders.

## Notes

- **Blocked at planning time.** On 2026-10-06 SBub/adw-dashboard #104 is OPEN with no linked PR. Step 1 is a hard gate; an implementer must not write placeholder SHAs or a branch name to get past it.
- The `repo` schema extension is scoped to what this doc needs (one other repo, in an enum). It is not in the issue body but is required: without it the doc's code links and Verified in link would point at this repo, `content.unit.test.ts` would fail on paths that do not exist locally, and `check-links` would 404.
- From the #104 issue body, the live connection is a Supabase realtime channel (catch-up on `SUBSCRIBED`), so `sse-route-handler` is expected to be dropped. Confirm at the pinned SHA.
- The mini app may use `EventSource` or an in-file timer source as the domain-neutral stand-in for the realtime channel; the `### In this repo` list then explains that production uses a Supabase channel and where.
- No new dependencies.
- Commits: `feat(patterns): ...` scope, conventional, no `Co-Authored-By`. The document phase will add `app_docs/feature-b50794d3-<slug>.md` and its `docs/conditional-docs.md` entry under `## apps/patterns` (the `repo` field changes the frontmatter contract, which is a "when to read" condition).
- `patterns` is never started by ADW; no dev server for it. No Supabase, migration or port changes.
