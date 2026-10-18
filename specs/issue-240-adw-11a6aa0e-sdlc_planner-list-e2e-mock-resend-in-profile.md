# Chore: list E2E_MOCK_RESEND in the ADW profile so an ADW e2e run never sends real email

## Metadata

issue_number: `240`
adw_id: `11a6aa0e`
issue_json: `{"number":240,"title":"chore: list E2E_MOCK_RESEND in the ADW profile so an ADW e2e run never sends real email"}`

## Chore Description

An ADW run's Playwright suite must never send a real email through Resend.

`apps/website/playwright.config.ts` sets `E2E_MOCK_STRIPE`, `E2E_MOCK_ICAL_FAILURE` and `E2E_MOCK_RESEND` (all `"true"`) in `webServer.env`, but that map only reaches a server Playwright spawns itself. In an ADW run Playwright never spawns the server: `prepare_app` starts `website` first on the run's port and `reuseExistingServer` adopts it. `prepare_app` takes its environment overrides from the ADW profile alone, and `.adw/project.md` (Workspaces section, the "Starting `website` on a port other than 3000" bullet, lines 34 to 38) lists only `E2E_MOCK_STRIPE`, `E2E_MOCK_ICAL_FAILURE` and the six `ROOM{1,2}_ICAL_*` variables.

So the ADW server runs without the Resend mock, and because `.env.development` carries a real `RESEND_API_KEY` and `ADMIN_NOTIFICATION_EMAIL`, `e2e/shop.integration.spec.ts` sends a real wishlist confirmation email and a real seller notification to the owner on every ADW e2e run. The lock-in waitlist e2e work filed next to this issue adds a welcome email per sign-up, which would go out the same way.

The fix is a documentation-only edit: add `E2E_MOCK_RESEND=true` to the profile bullet with a one-clause reason, and bring the one other doc that lists the e2e in-process mocks (`apps/website/AGENTS.md`) in step. No code, config, spec, env file or port changes.

## Relevant Files

Use these files to resolve the chore:

- `.adw/project.md` - the ADW profile. Lines 34 to 38 (Workspaces section) hold the "Starting `website` on a port other than 3000" bullet that `prepare_app` reads its overrides from. This is the primary edit. Its nine `##` headings (Identity, Workspaces, Install, Build, Tests, Ports, Protected, Documentation, Review) and their order are a contract with the toolkit and must not change.
- `apps/website/AGENTS.md` - lines 56 to 63 say the Playwright `e2e/` suite needs "the `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` in-process mocks from `src/instrumentation.ts`". It is the other living doc that enumerates the e2e mocks, so add `E2E_MOCK_RESEND` there in the same change (issue Change item 3).
- `apps/website/playwright.config.ts` - read only. Lines 105 to 116 confirm the three mocks in `webServer.env`. Must not change.
- `apps/website/src/instrumentation.ts` - read only. `registerE2EMocks` (docblock around line 56) confirms `E2E_MOCK_RESEND=true` mocks `POST https://api.resend.com/emails` and explains the real-key risk. Must not change.
- `apps/website/e2e/shop.integration.spec.ts` - read only. Lines 28 and 696 rely on the server running with `E2E_MOCK_RESEND`. Must not change.
- `apps/website/app_docs/environment-setup.md` - checked: it has an env variable table (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, ...) but does not list any `E2E_MOCK_*` variable or the non-3000 port overrides, so it needs no edit.
- `docs/conditional-docs.md` - its "Cross-cutting constraints" entry for `.adw/project.md` matched ("When running or changing anything the ADW toolkit does in this repository", and the nine-headings contract). No new doc is added, so no new index entry is needed.
- `AGENTS.md` (root) - repo conventions (yarn only, conventional commits, no attribution trailers). Does not mention the e2e mocks, so no edit; the profile states it must be kept in step with this file, which this change does not affect.

Not edited, on purpose: `apps/website/app_docs/feature-cc081a8b-gate-browser-tests-in-ci.md` (line 133) also names only the Stripe and iCal mocks, but it is a historical feature record of that change, not a living reference; rewriting it would misstate what that feature shipped.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Update the profile's non-3000 bullet in `.adw/project.md`

- In the Workspaces section, edit the bullet that begins "Starting `website` on a port other than 3000:" (currently lines 34 to 38).
- Add `E2E_MOCK_RESEND=true` to the exported variables, next to `E2E_MOCK_STRIPE=true` and `E2E_MOCK_ICAL_FAILURE=true`.
- Add one clause on why, for example: `E2E_MOCK_RESEND=true` keeps the integration specs' wishlist, seller and waitlist emails off the real Resend key that `.env.development` carries. Keep the existing sentences (the iCal rewrite rule, "an exported variable wins over `.env.development`") intact.
- Suggested final text (wrap to the file's existing ~100 column width; prettier will settle it):
  ```md
  - Starting `website` on a port other than 3000: export `E2E_MOCK_STRIPE=true`,
    `E2E_MOCK_ICAL_FAILURE=true`, `E2E_MOCK_RESEND=true`, and the six
    `ROOM{1,2}_ICAL_{AIRBNB,VRBO,BOOKING}` variables with `http://localhost:3000/dev-ical/...`
    rewritten to `http://localhost:$PORT/dev-ical/...` (only the port; leave a real OTA URL
    untouched). The app serves those feeds itself and the integration specs need the in-process
    mocks; without `E2E_MOCK_RESEND` the wishlist, seller and waitlist emails those specs trigger go
    out through the real Resend key in `.env.development`. An exported variable wins over
    `.env.development`.
  ```
- Do not touch any `##` heading, the workspace table, or any other section.
- No em dashes; use commas, colons or parentheses.

### 2. Bring `apps/website/AGENTS.md` in step

- In the bullet "The Playwright `e2e/` suite is **deliberately not in CI**" (around lines 56 to 63), change "the `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` in-process mocks" to list all three: `E2E_MOCK_STRIPE` / `E2E_MOCK_ICAL_FAILURE` / `E2E_MOCK_RESEND`.
- Change nothing else in that file.

### 3. Do not touch anything out of scope

- Do not read, print, copy or edit any `.env*` file other than `.env.example`; do not add `E2E_MOCK_RESEND` to an env file.
- Do not change `playwright.config.ts`, `instrumentation.ts`, any spec, any port, `adws/` or `.claude/commands/` (symlinks into the toolkit).

### 4. Run the Validation Commands

- Run every command in the section below and confirm each passes.

## Test Coverage

No test needed: this is a documentation-only edit to the ADW profile and `apps/website/AGENTS.md`. The mock itself (`E2E_MOCK_RESEND` in `instrumentation.ts`) already exists and is exercised by `e2e/shop.integration.spec.ts`; what changes is only which environment `prepare_app` exports, which is toolkit behaviour driven by prose that none of the profile's test layers (`*.unit.test.ts`, `*.browser.test.tsx`, `apps/website/e2e/*.spec.ts`) can observe. The issue lists "Any new test" as out of scope. The structural guarantees (bullet present, nine headings intact, formatting) are checked by the validation commands below.

No E2E spec or review screenshots are needed: no user-visible flow changes.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `git grep -n "E2E_MOCK_RESEND" -- .adw/project.md` - must print the new line, with a line number inside the Workspaces section (between the `## Workspaces` and `## Install` headings).
- `grep -n '^## ' .adw/project.md` - must print exactly nine headings, in order: Identity, Workspaces, Install, Build, Tests, Ports, Protected, Documentation, Review.
- `grep -c '^## ' .adw/project.md` - must print `9`.
- `git grep -n "E2E_MOCK_RESEND" -- apps/website/AGENTS.md` - must print the updated e2e bullet.
- `git diff --name-only` - must list only `.adw/project.md`, `apps/website/AGENTS.md` and this spec file; no `.env*`, `playwright.config.ts`, `instrumentation.ts` or spec file.
- `git diff -U0 | grep -n '—' ; test $? -eq 1` - confirms no em dash was introduced (the grep must find nothing).
- `yarn prettier --check .` - the profile's format check (also run by lefthook on commit); both edited files are markdown, so this is the check that can fail.
- `yarn knip` - the profile's whole-repo dead-code check that lefthook runs on commit; must stay green (unaffected by markdown, run to confirm zero regressions).

Typecheck, lint, unit tests and build are not run: no TypeScript, Python or config file changes, and this is a repo-root profile edit plus a markdown rule file, so those commands cannot be affected.

## Notes

- Commit as a root/docs change with no scope, Conventional Commits, for example `chore: list E2E_MOCK_RESEND in the ADW profile`. No `Co-Authored-By`, "Generated with" or "Authored by" lines. The `Deploy-Preview: yes` trailer is added by the toolkit's document phase, not here.
- `docs/conditional-docs.md` needs no new entry: no new doc file is created.
- The welcome email from the lock-in waitlist e2e issue filed alongside this one will be covered by the same `E2E_MOCK_RESEND` handler (it mocks every `POST https://api.resend.com/emails`), so the clause can name "waitlist" emails now.
