# Vercel: build ADW previews only for the run's final commit

**ADW ID:** b82db496
**Date:** 2026-09-24
**Specification:** specs/issue-110-adw-b82db496-sdlc_planner-vercel-preview-final-commit-only.md

## Overview

Every ADW phase commits and pushes, so one run pushed about five commits and each of the three Vercel projects (`ihas-website`, `ihas-guest-communication-agent`, `ihas-telegram-router`) built a preview for every one: roughly 15 deployments per issue, which hit the Hobby plan's 100/day cap on 2026-09-21. A shared Vercel Ignored Build Step now skips every commit on an ADW branch except the one the toolkit marks with a `Deploy-Preview: yes` trailer (the document phase's final commit), so a run costs one preview per project instead of five.

## What Was Built

- `scripts/vercel-ignore.sh`: one shared Ignored Build Step script at the repo root
- `ignoreCommand` wired into all three apps' `vercel.json` (two new files, one extended)
- A vitest unit test that runs the real script against throwaway git repos
- A turbo input so the website test re-runs when the root script changes
- A root `AGENTS.md` rule, plus a pointer in `apps/telegram-router/README.md`

## Technical Implementation

### Files Modified

- `scripts/vercel-ignore.sh`: new, executable. Exit 1 means build, exit 0 means skip.
- `apps/website/vercel.json`: new, only `$schema` and `ignoreCommand`.
- `apps/guest-communication-agent/vercel.json`: new, only `$schema` and `ignoreCommand`.
- `apps/telegram-router/vercel.json`: `ignoreCommand` added; the existing `installCommand` and `buildCommand` are kept (removing them ships a function with no packages).
- `apps/website/src/lib/__tests__/vercel-ignore.unit.test.ts`: new, eight cases covering every branch of the script.
- `turbo.json`: new `website#test` entry whose `inputs` add `$TURBO_ROOT$/scripts/vercel-ignore.sh`.
- `AGENTS.md`: new bullet in the Python-workspaces section, next to the other Vercel notes.
- `apps/telegram-router/README.md`: one sentence in the Deployment section about `ignoreCommand`.

### Key Changes

- **Decision order in the script:** `VERCEL_ENV=production` always builds; any `VERCEL_GIT_COMMIT_REF` that doesn't contain `-adw-` builds (including an empty ref from a dashboard Redeploy or CLI deploy); on an `-adw-` branch it builds only if a line of the commit message starts with `Deploy-Preview: yes`, otherwise it skips and the deployment shows as Canceled.
- **Commit message source:** the script reads the full message with `git log -1 --format=%B` and falls back to `VERCEL_GIT_COMMIT_MESSAGE` only when git returns nothing. The match is exactly `grep -q '^Deploy-Preview: yes'`, so the phrase quoted mid-line doesn't count.
- **Build-image only tools:** `bash`, `case`, `git`, `grep`. No node, npx or turbo-ignore.
- **Path:** each project's Root Directory is `apps/<app>`, so every `ignoreCommand` is `bash ../../scripts/vercel-ignore.sh`.
- **Test isolation:** the test builds the child process env from scratch (so a `VERCEL_*` variable in the developer's shell can't leak in) and passes an inline git identity, so it works without a configured git user.

## How to Use

1. Nothing to do for ADW runs: the toolkit's document phase adds the trailer to the final commit and that commit is the only one that builds a preview.
2. To force a preview on an ADW branch by hand:
   `git commit --allow-empty -m "chore: preview" -m "Deploy-Preview: yes"`
3. When adding a new Vercel-deployed app, give its `vercel.json` the same `"ignoreCommand": "bash ../../scripts/vercel-ignore.sh"` line.

## Configuration

- No environment variables to set; the script reads Vercel's own `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_COMMIT_MESSAGE`.
- Each project's dashboard Ignored Build Step must stay on "Automatic"; `vercel.json` overrides it anyway.
- "Include files outside the Root Directory" must be on in each project, or `../../scripts/vercel-ignore.sh` is missing. In that case `bash` exits 127, which Vercel treats as "build", so it fails open (same behaviour as before this change).
- The trailer string is a shared contract with the ADW toolkit's `git_ops.PREVIEW_TRAILER`. Never change it on one side only.

## Testing

- `yarn workspace website test` runs `vercel-ignore.unit.test.ts` in the vitest `unit` project. It covers: skip on a plain ADW commit, build with the trailer, build on a non-ADW branch, build on an empty ref, always build production, skip when the trailer text is not at the start of a line, and the `VERCEL_GIT_COMMIT_MESSAGE` fallback outside a git repo.
- Real Vercel behaviour can only be checked by a human against the account (see the spec's manual checklist): push a throwaway `test-adw-ignore` branch with a plain commit and confirm the deployment count doesn't rise by 3, then push a trailer commit and confirm it builds in all three projects while the earlier one shows Canceled.

## Notes

- This change spans several workspaces plus repo-root files. The core logic lives in root `scripts/vercel-ignore.sh`; it is documented under `apps/website` because that workspace holds its test and the turbo input that keeps the test honest.
- Open risk from the spec: if Vercel counts Canceled (ignored) deployments toward the 100/day cap, this approach doesn't relieve it. Manual verification step 1 decides that before merge.
- On ADW-run PRs, expect Canceled Vercel statuses on intermediate commits and a built one only on the document-phase head.
- Out of scope: `turbo-ignore` / per-app build pruning, `ci_ops` changes, and the `git.deploymentEnabled` fallback.
