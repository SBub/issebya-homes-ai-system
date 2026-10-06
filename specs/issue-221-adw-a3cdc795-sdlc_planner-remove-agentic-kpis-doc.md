# Chore: remove docs/agentic-kpis.md and its references

## Metadata

issue_number: `221`
adw_id: `a3cdc795`
issue_json: `{"number":221,"title":"chore: remove docs/agentic-kpis.md and its references","body":"The ADW toolkit stops writing the per-repo KPI markdown (SBub/adw-toolkit#34): `adw.run_metrics`is the single definition of run metrics and the dashboard renders it. Delete`docs/agentic-kpis.md`and every reference to it (README, AGENTS.md,`.adw/project.md`, any docs index or conditional-docs entry). No code change expected. Run after toolkit #34 has merged, otherwise the next run recreates the file.\n"}`

## Chore Description

The ADW toolkit used to append a KPI table to `docs/agentic-kpis.md` in every onboarded repository
after each run. Toolkit issue SBub/adw-toolkit#34 (merged as PR #39, commit `730779e chore: remove
agentic kpis, add change stats to run metrics`) removed that writer: run metrics now live only in
`adw.run_metrics` and the ADW dashboard renders them. The per-repo markdown file is therefore dead
weight and would drift. Delete it and every reference to it in this repository.

The precondition in the issue ("run after toolkit #34 has merged") is satisfied: the toolkit's
`master` history contains the merge, and a repository-wide search of the toolkit (`commands/`,
`adws/`) finds no remaining writer or reader of `agentic-kpis` outside its own historical specs.

Reference search in this repository (`grep -rni "agentic-kpis\|kpi"` over everything except
`node_modules`, `.git`, build output) finds exactly two things:

1. `docs/agentic-kpis.md` itself (tracked by git).
2. `.adw/project.md` line 133, in the `## Documentation` section: `- KPI table: \`docs/agentic-kpis.md\`.`

`README.md`, `AGENTS.md`, `docs/conditional-docs.md`, `specs/`, `.github/`, `package.json`, knip and
prettier config contain no reference. No code change.

## Relevant Files

Use these files to resolve the chore:

- `docs/agentic-kpis.md` - the file to delete.
- `.adw/project.md` - ADW profile; its `## Documentation` section carries the only reference
  (`- KPI table: \`docs/agentic-kpis.md\`.`). The nine `##` headings are a contract with the
  toolkit commands: remove the bullet only, never rename/reorder a heading.
- `AGENTS.md` - checked, no reference; listed because the issue names it and it must stay in step
  with `.adw/project.md`.
- `README.md` - checked, no reference; listed because the issue names it.
- `docs/conditional-docs.md` - the docs index; checked, no entry for the KPI file, so nothing to
  remove.

No new files.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Delete the KPI document

- `git rm docs/agentic-kpis.md`.

### 2. Remove the profile reference

- In `.adw/project.md`, `## Documentation` section, delete the single line
  `- KPI table: \`docs/agentic-kpis.md\`.`(the last bullet before`## Review`).
- Leave the blank line before `## Review` and every heading untouched.

### 3. Confirm no reference remains

- Run `grep -rni --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.turbo --exclude-dir=.next "agentic-kpis\|KPI table" .`
  It must print matches only from this plan file under `specs/` (the plan itself documents the
  removal). Any other hit is a missed reference: remove it.

### 4. Run the validation commands

- Run every command in `Validation Commands` below; all must exit 0.

### 5. Commit

- Conventional commit, no scope (root `docs/` + root config): `chore: remove docs/agentic-kpis.md and its references`.
- No `Co-Authored-By`, "Generated with" or "Authored by" lines; do not add or strip the
  `Deploy-Preview` trailer (the document phase owns it). Never `--no-verify`.

## Test Coverage

No test needed: the change deletes a generated markdown file and one line of documentation in the
ADW profile. No code, config or runtime behaviour changes, so there is nothing a unit, browser or
Playwright test could assert that would fail without this change. The grep in task 3 is the
verification. No E2E spec or screenshots: no workspace's user-visible flow is touched.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

Repo-root-only change, so the profile's commands run unfiltered.

- `test ! -e docs/agentic-kpis.md` - the file is gone.
- `! grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.turbo --exclude-dir=.next --exclude-dir=specs "agentic-kpis" .` - no reference remains outside specs.
- `grep -c '^## ' .adw/project.md` - must print `9`: the profile's nine-heading contract is intact.
- `yarn prettier --check .` - the edited `.adw/project.md` is still formatted.
- `yarn knip` - dead-code check stays green (no file it tracks referenced the doc).
- `yarn turbo run typecheck` - lefthook commit gate; confirms nothing else broke.
- `yarn turbo run lint` - lefthook commit gate.
- `yarn turbo run test` - lefthook push gate (unit + browser projects).
- `yarn turbo run build` - profile's build for a repo-root-only change.

## Notes

- Precondition verified at plan time: SBub/adw-toolkit#34 merged (toolkit `919e07a Merge pull
request #39`), so the next ADW run will not recreate `docs/agentic-kpis.md`. If the file
  reappears after a later run, the toolkit in use on that machine is stale, not this repo.
- `.claude/commands` is a symlink into the shared toolkit; do not edit it from this repo.
- Never run `supabase` commands or start a dev server; this chore needs neither.
- No feature doc and no `docs/conditional-docs.md` entry: a repo-root-only change gets none, and
  the index never listed the KPI file.
