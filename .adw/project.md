# ADW project profile

The ADW (AI Developer Workflow) profile of this repository. The toolkit's slash commands
(`.claude/commands/*.md`, a symlink into `adw-toolkit/commands/`) read it before anything else:
what this repository is, how it installs, builds and tests, which ports are reserved, what must
never run here. Committed so every worktree under `trees/<adw_id>/` carries it. The nine `##`
headings and their order are a contract with those commands (`adws/PROFILE.md` in the toolkit):
add facts under them, never rename or reorder them. Root `AGENTS.md` stays the rule book; this
file restates the subset the ADW commands need and must be kept in step with it.

## Identity

- name: `issebya-homes-ai-system`
- kind: `monorepo`. Yarn workspaces `apps/*` and `packages/*` under Turborepo; the root is also a
  uv workspace for the Python app.
- default branch: `develop`. `master` is production; never base a branch on it.
- package manager: Yarn 4.6.0 (Berry, node-modules linker, pinned via `packageManager`, provided by
  corepack). Never `npm`, `npx`, `pnpm` or `bun`. The Python workspace uses `uv`.
- Node: 24.14.0 (`volta` pin in `package.json`).

## Workspaces

| name                      | path                             | dev command                                    | port variable | default port | health URL                 | ADW may start |
| ------------------------- | -------------------------------- | ---------------------------------------------- | ------------- | ------------ | -------------------------- | ------------- |
| website                   | `apps/website`                   | `yarn workspace website dev:next`              | `PORT`        | 3000         | `/`, then `/booking/room1` | yes           |
| patterns                  | `apps/patterns`                  | `yarn workspace patterns dev`                  | `PORT`        | 3004         | `/`                        | no            |
| telegram-router           | `apps/telegram-router`           | `yarn workspace telegram-router-tasks dev`     | none          | 3003         | `/api/health`              | never         |
| guest-communication-agent | `apps/guest-communication-agent` | `yarn workspace guest-communication-agent dev` | none          | 3005         | none (webhook service)     | never         |
| pricing                   | `packages/pricing`               | none (library)                                 | -             | -            | -                          | no            |

- `website` is the only workspace ADW starts, only through `prepare_app`, and only with `dev:next`
  (plain `next dev`, port from `PORT`): `dev` runs `scripts/start.ts`, which also boots local
  Supabase and a Stripe listener and kills whatever holds port 3000.
- Starting `website` on a port other than 3000: export `E2E_MOCK_STRIPE=true`,
  `E2E_MOCK_ICAL_FAILURE=true`, and the six `ROOM{1,2}_ICAL_{AIRBNB,VRBO,BOOKING}` variables with
  `http://localhost:3000/dev-ical/...` rewritten to `http://localhost:$PORT/dev-ical/...` (only the
  port; leave a real OTA URL untouched). The app serves those feeds itself and the integration
  specs need the in-process mocks; an exported variable wins over `.env.development`.
- `telegram-router` is Python (FastAPI, uv): thin `package.json` name `telegram-router-tasks`,
  `pyproject.toml` `[project] name` `telegram-router`. Resolve a `target_apps` name to its directory
  by matching either field under `apps/*` and `packages/*`.

## Install

From the worktree root, in order. The main checkout is two directories up from `trees/<adw_id>/`.

1. Copy from the main checkout, each only if it exists there, preserving its path:
   `.env.development` (root, ADW configuration), and both `.env.development` and `.env.production`
   of `apps/website`, `apps/telegram-router` and `apps/guest-communication-agent`. Both files per
   app are required: `next build` runs with `NODE_ENV=production` and reads only `.env.production`
   (and `.env`), so a missing production file fails the build on a missing secret
   (`STRIPE_SECRET_KEY` surfaces as `Neither apiKey nor config.authenticator provided`). Never copy
   `.env.example`; never invent a value for a missing file, report it.
2. `yarn install --immutable` (every workspace; `postinstall` runs `lefthook install`).
3. `uv sync --locked` (the Python workspace, as CI does).
4. Verify with a build (see Build), unfiltered unless the target workspaces are known. A build, not a
   typecheck: only a build loads `.env.production` and proves step 1 worked.

Must NOT run here: any dev server, `supabase start`, `supabase stop`, `supabase db reset`, any
migration or seed.

## Build

- `yarn turbo run build --filter=./apps/<dir>` (repeat `--filter` per target workspace);
  `yarn turbo run build` for a repo-root-only change or an unknown target.
- `--filter` always takes the directory path (`./apps/website`), never the package name: a Python
  workspace has two turbo packages at one directory and the name form resolves only one, reporting
  `No tasks were executed` with exit 0 while a real failure goes unseen.

## Tests

In the order the test phase runs them (`<path>` as in Build; drop `--filter` for a repo-root-only
change): typecheck `yarn turbo run typecheck --filter=<path>`; lint `yarn turbo run lint --filter=<path>`
(autofix `lint:fix`); format `yarn prettier --check .` (write `yarn prettier --write .`); dead code
`yarn knip` (whole repo); unit `yarn turbo run test --filter=<path>` (Vitest; `website` runs its
`unit` and chromium `browser` projects); build as above.

Test layers a plan may use: `*.unit.test.ts` (pure logic), `*.browser.test.tsx` (Vitest browser
mode), `apps/website/e2e/*.spec.ts` (Playwright); formats under `apps/website/app_docs/testing/`.

E2E: a Playwright integration suite exists for `website` only. The test phase runs it last, only
when `website` is a target: `PORT=<run port> yarn workspace website test:integration --project=chromium`.
The `prepare_app` server must already be up on this run's port (`reuseExistingServer` adopts it,
with the overrides above); never set `CI=1`, which disables that reuse. The specs seed and clean up
fixtures in the shared local Supabase via `createAdminClient()`, acceptable only because runs are
serial. Agent-driven `e2e/*.md` journeys at the repo root are opt-in and normally absent.

lefthook runs prettier, lint, typecheck and knip (ruff and mypy for `*.py`) on every commit and
`yarn turbo run test` on every push. Never bypass it.

## Ports

- 3003 (`telegram-router`) and 3005 (`guest-communication-agent`) are pinned by an external
  contract: one reserved ngrok hostname fronts `scripts/dev-webhook-gateway.ts` on 3010, which routes
  by path prefix to them. Twilio and Telegram hold registered URLs against it. GitHub label events
  go to the Supabase Edge Function `github-webhook`, not the tunnel. Never move these ports or start
  a second process on them.
- 3004 (`patterns`) and 3000 (`website`) are defaults outside that contract; `website` honours
  `PORT`, which is what gives each run its own server. This run's port is in `.ports.env` at the worktree root (`PORT`, `BACKEND_PORT`, `FRONTEND_PORT`),
  written by the engine. Source it; never write, edit or delete it; fall back to 3000 only when it
  is absent. A server on 3000 when `PORT` is not 3000 is the developer's or an older run's: never
  reuse, probe, `lsof` or kill it.

## Protected

- Never start a dev server for `telegram-router` or `guest-communication-agent`.
- Never run `supabase start`, `supabase stop`, `supabase db reset`, a migration or a seed: one
  shared local Supabase instance, which the per-run port does not isolate. Runs stay serial.
- Never `npm`, `npx`, `pnpm` or `bun`. A new dependency is `yarn workspace <name> add <pkg>`.
- Never pass `--no-verify`; never weaken a rule, a type or a test to make a check pass.
- Never kill a process this run did not start; never change a port through `package.json`,
  `.ports.env` or any committed file.
- Never read, print or copy a secret into a tracked file; never fabricate an env value.
- Never put project tests under `.claude/commands/e2e/` (a symlink into the shared toolkit).

## Documentation

- Plans: `specs/issue-<issue_number>-adw-<adw_id>-sdlc_planner-<slug>.md`; patch plans:
  `specs/patch/patch-adw-<adw_id>-<slug>.md` (see `specs/README.md`).
- Feature docs: `<workspace path>/app_docs/feature-<adw_id>-<slug>.md`, screenshots in
  `<workspace path>/app_docs/assets/`. A repo-root-only change gets no feature doc.
- Index to update: `docs/conditional-docs.md`, one section per workspace (`## apps/website`, ...);
  append the entry at the end of that section with two or three "when to read" conditions.
- Read before planning: root `AGENTS.md`, the target workspace's `AGENTS.md` (and `ENGINEERING.md`
  where present), then the `docs/conditional-docs.md` entries whose conditions match.
- Commits: Conventional Commits with the workspace name as scope (`website`, `telegram-router`,
  `guest-communication-agent`, `pricing`, `patterns`); no scope for `specs/`, `docs/`, root config
  or a multi-workspace change. No `Co-Authored-By`, "Generated with" or "Authored by" lines.
- Required trailer: `Deploy-Preview: yes` on branches whose name contains `-adw-`. The toolkit's
  document phase appends it to the run's final commit itself (`git_ops.PREVIEW_TRAILER`), and every
  app's `vercel.json` `ignoreCommand` (`scripts/vercel-ignore.sh`) builds an `-adw-` commit only
  when it carries it. Slash commands never add or strip it. By hand:
  `git commit --allow-empty -m "chore: preview" -m "Deploy-Preview: yes"`.

## Review

- Open at `http://localhost:$PORT`: `/`, `/booking/room1` (and `/booking/room2`), plus whichever of
  `/blog`, `/blog/<slug>`, `/shop`, `/shop/<slug>` the spec touches. Capture each path at desktop
  1920x1080 and mobile 375x667, full page, into `agents/<adw_id>/<agent_name>/review_img/` in the
  worktree; the phase uploads them to R2 when configured.
- Only `website` has a browser surface ADW starts: `telegram-router`, `guest-communication-agent`
  and `pricing` get no visual review, and `patterns` (pages, but never started by ADW) is reviewed
  from the diff and the build. Browser automation is the Playwright MCP server in `.mcp.json`,
  configured by `playwright-mcp-config.json` (headless chromium, 1920x1080).
