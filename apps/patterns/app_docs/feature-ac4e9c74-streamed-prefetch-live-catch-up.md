# Streamed prefetch with live catch-up composite and cross-repo code links

**ADW ID:** ac4e9c74
**Date:** 2026-10-07
**Specification:** specs/issue-225-adw-ac4e9c74-sdlc_planner-streamed-prefetch-live-catch-up.md

## Overview

Adds the `streamed-prefetch-live-catch-up` composite to the patterns library. It shows how a constantly changing list is streamed per request, hydrated into the query cache, and kept current by a live subscription that re-reads once when it opens. The proof code lives in `SBub/adw-dashboard`, so the frontmatter contract gains an optional `repo` field that points code links and "Verified in" links at another repository.

## What Was Built

- `content/streamed-prefetch-live-catch-up.mdx`: the composite doc (`uses` five atoms, `repo: SBub/adw-dashboard`, every `code[].ref` pinned to the merge commit of dashboard PR #111, `verifiedIn: [111]`). It covers why such data must not sit in `"use cache"`, the one shared cache entry read through `select`, and when client-only fetching is acceptable instead.
- An optional doc-level `repo` (`owner/name`) in the frontmatter schema. When absent, links are exactly what they were before.
- Repo-aware link builders, rendering components and link check.

## Technical Implementation

### Files Modified

- `apps/patterns/src/lib/patterns/schema.ts`: optional `repo`, validated by a flat `owner/name` regex.
- `apps/patterns/src/lib/patterns/links.ts`: `REPO` becomes the exported `DEFAULT_REPO`; `blobUrl`, `rawUrl` and `pullUrl` take an optional repo.
- `apps/patterns/src/app/ui/CodeLinks.tsx`, `apps/patterns/src/app/ui/RelationsPanel.tsx`, `apps/patterns/src/app/p/[slug]/page.tsx`: pass the doc's `repo` to the URL builders.
- `apps/patterns/scripts/check-code-links.ts`: fetches each entry from its doc's repo and prints the repo in the log line only when it is not the default.
- `apps/patterns/src/lib/patterns/__tests__/{schema,links,content}.unit.test.ts`: `repo` parsing, URLs for an explicit repo, and the on-disk existence test restricted to docs without a foreign `repo`.
- `apps/patterns/content/INDEX.md`, `apps/patterns/src/lib/patterns/manifest.generated.ts`: regenerated.
- `apps/patterns/README.md`, `apps/patterns/AGENTS.md`: the `repo` field and the rule for foreign-repo docs.

### Key Changes

- `repo` defaults to `SBub/issebya-homes-ai-system`, so the existing docs produce byte-identical links.
- For a foreign-repo doc, `yarn workspace patterns check-links` (network, pinned SHA) is the proof that each file exists. The local disk test skips it.
- `sse-route-handler` is not in `uses`: the dashboard's live connection is a Supabase Realtime channel (WebSocket), not Server-Sent Events.

## How to Use

1. Read `/p/streamed-prefetch-live-catch-up` (or `content/streamed-prefetch-live-catch-up.mdx`) when building a live list in a Next app.
2. To write a doc whose proof code is in another repository, set `repo: owner/name`, pin each `code[].ref` to a SHA on that repo's origin, and list that repo's PR numbers in `verifiedIn`.
3. Run `yarn workspace patterns check-links` to confirm every link resolves.

## Configuration

None. No new dependency or environment variable.

## Testing

- `yarn turbo run test --filter=./apps/patterns` covers the schema, link builders, content rules and generated-file freshness.
- `yarn workspace patterns check-links` (network) proves the dashboard files exist at the pinned SHA.

## Notes

- The doc is pinned to the merge commit, which stays valid if `develop` moves.
- `branch-protection.mdx` still says the dashboard is not linked; it could now link it through `repo`.
