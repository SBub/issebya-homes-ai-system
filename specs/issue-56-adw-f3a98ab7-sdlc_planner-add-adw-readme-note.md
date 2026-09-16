# Chore: Add ADW maintenance note to the website README

## Metadata

issue_number: `56`
adw_id: `f3a98ab7`
issue_json: `{"number":56,"title":"ADW webhook smoke test","body":"Testing the webhook trigger. Add a line to the website README saying the site is maintained by ADW\n\n/adw_plan_iso"}`

## Chore Description

This issue is a smoke test for the ADW webhook trigger. The concrete, actionable
part of the request is: add a line to the website's README stating that the site
is maintained by ADW (AI Developer Workflow). This is a documentation-only change
scoped to `apps/website/README.md` — no code, config, or behavior changes.

## Relevant Files

Use these files to resolve the chore:

- `apps/website/README.md` - the target file. It currently has no line about who
  maintains the site; we need to add one. Per the repo's four-file doc convention
  (`AGENTS.md`), `README.md` is the human-facing "what the project is and how to
  use it" file, so a maintenance note belongs here rather than in
  `apps/website/AGENTS.md` (behavioral rules only) or `ENGINEERING.md` (deep
  technical walkthrough).
- `apps/website/AGENTS.md` - read per the repo convention (always read a
  workspace's own `AGENTS.md` before changing anything under it); confirms this
  is a docs-only change with no code conventions to apply, and confirms
  `README.md` is the right place for this kind of note rather than `AGENTS.md`.
- `AGENTS.md` (repo root) - confirms the four-file documentation convention and
  that `README.md` is human-facing, which is why the maintenance note goes there.
- `docs/conditional-docs.md` - checked for additional required reading; only the
  "Always" entries (`AGENTS.md`, `README.md`) apply to a README-only edit under
  `apps/website/`. No other conditional doc (Next.js patterns, data fetching,
  forms, database, etc.) is triggered because no code is changing.

No new files are needed.

## Step by Step Tasks

### Add the ADW maintenance note to the website README

- Open `apps/website/README.md`.
- Add a short, single line near the top of the file (directly under the
  introductory paragraph, before the `## Features` section) stating that the
  site is maintained by ADW, e.g.:
  `This site is maintained by ADW (AI Developer Workflow).`
- Keep it to one line, matching the plain, factual tone of the rest of the
  README's intro paragraph. Do not add a new heading/section for this — it's a
  single sentence, not a topic that needs its own `##` header.

### Validate formatting and repo-wide checks

- Run the validation commands below and confirm they all pass with zero
  regressions. Since this is a Markdown-only change, `lint`/`typecheck`/`test`/
  `build` are not expected to be affected, but they are run anyway per repo
  convention to guarantee no regressions.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check apps/website/README.md` - Formatting of the edited file matches the repo config, so the commit hook will not reject it
- `yarn prettier --check .` - Formatting matches the repo config repo-wide, so the commit hook will not reject it
- `yarn turbo run lint --filter=@issebya/website` - Lint passes for the website workspace (no code changed, expected to be a no-op pass)
- `yarn turbo run typecheck --filter=@issebya/website` - Types are sound for the website workspace (no code changed, expected to be a no-op pass)
- `yarn knip` - No unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=@issebya/website` - Unit tests pass, proving the chore introduced zero regressions
- `yarn turbo run build --filter=@issebya/website` - Production build succeeds

## Notes

- This chore originates from an ADW webhook smoke-test issue; the body's
  trailing `/adw_plan_iso` line is the ADW slash-command invocation that
  triggered this planning step, not part of the requested content change — it
  should not be copied into the README.
- No conditional docs beyond the "Always" entries apply since this change
  touches only `apps/website/README.md` and no application code, routes,
  components, forms, or database logic.
