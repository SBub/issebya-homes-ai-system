# Chore: Deploy the FastAPI telegram-router on Vercel, and make its telemetry survive a Function

## Metadata

issue_number: `74`
adw_id: `7ec40311`
issue_json: `{"number":74,"title":"Deploy the FastAPI telegram-router on Vercel, and make its telemetry survive a Function"}`

## Chore Description

PR #73 ported `apps/telegram-router` from Next.js to FastAPI. Every CI check passes
except the Vercel deployment for the project `ihas-telegram-router`, which is still
configured with the Next.js framework preset in Vercel's dashboard. The app has no
`next` dependency, no `build` script and no Next files, so the preset has nothing to
build.

This chore closes the deployment gap on the repository's side, and fixes two pieces of
`app/main.py` that were written for a long-lived uvicorn process and do not hold their
guarantees on a Vercel Function:

1. **Span export.** `BatchSpanProcessor` buffers spans and flushes on its own timer. A
   Vercel Function (even with Fluid compute, which reuses instances) gives no guarantee
   that the timer fires before the instance goes away, so spans are silently dropped.
   This is the identical failure `apps/guest-communication-agent` already solves with
   `after(() => flushTracing())`. The fix here: an HTTP middleware that force-flushes
   the tracer provider after the handler returns and before the response goes out, plus
   a bounded flush in the lifespan's shutdown path. It must follow GCA's contract, a
   flush failure is swallowed and logged and can never change the HTTP response.
2. **The heartbeat.** `app/main.py`'s `while True:` / 300-second-sleep task feeds an
   Axiom dead-man's-switch monitor so that low, sporadic traffic does not look like an
   outage. On a request-driven function it fires unreliably, which turns the monitor
   into a false-alarm generator: exactly the problem it was added to prevent. **Decision:
   remove it**, and replace the daemon-shaped monitor with an external uptime ping
   against a new, cheap `GET /api/health` route. The route is the part that lives in this
   diff; retiring the Axiom monitor and pointing an uptime check at the health route are
   dashboard actions (see Human prerequisites).

Everything else about the app is a contract and must not move: the registered webhook
path `POST /api/telegram/webhook`, the `X-Telegram-Bot-Api-Secret-Token` verification
(failing closed when `TELEGRAM_WEBHOOK_SECRET` is unset), the always-200 rule once
authenticated, `AXIOM_DATASET` / OTel service name `telegram-router`, all 16 span names
and attribute keys, port 3003 for `yarn dev`, uv workspace membership, and no
`requirements.txt`.

### Human prerequisites (cannot be done from the diff)

These are dashboard actions. The Vercel check will keep failing until the first one is
done, and the implementing agent must not attempt any of them.

- Vercel → project `ihas-telegram-router` → Settings → General:
  - **Framework Preset**: `Next.js` → `Other` (or FastAPI, if offered).
  - **Root Directory**: leave as `apps/telegram-router`.
  - Keep **Include files outside the Root Directory** enabled, so the repo-root
    `uv.lock` / `.python-version` are part of the build context.
- Vercel → same project → Environment Variables:
  - Remove `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (they existed only for
    `next.config.ts`'s `withSentryConfig` source-map upload, which no longer exists) and
    `ENABLE_EXPERIMENTAL_COREPACK` (a Next/yarn build-image flag, meaningless for a
    Python function).
  - Confirm `ENVIRONMENT=production` is set. `app/main.py`'s lifespan gates the
    "Axiom is mandatory" and "Sentry on" branches on it, and Python has no `NODE_ENV`
    equivalent, so without it a production deployment boots with the dev policy.
  - Confirm `AXIOM_TOKEN`, `AXIOM_DATASET=telegram-router`, `AXIOM_DOMAIN`, `SENTRY_DSN`,
    `TELEGRAM_*` and `GUEST_COMMUNICATION_AGENT_*` are present.
- Axiom: delete or disable the telegram-router dead-man's-switch monitor that alarms on
  "no `instrumentation.heartbeat` span in N minutes". After this chore that span no
  longer exists, so the monitor would alarm permanently on a healthy system.

## Relevant Files

Use these files to resolve the chore:

- `apps/telegram-router/app/main.py` - the whole change lives here: the
  `BatchSpanProcessor` at line 39, the heartbeat task at lines 76-89 and 96-97,
  `HEARTBEAT_INTERVAL_SECONDS` at line 21, the `asyncio` import at line 1, the shutdown
  path at line 98, and the `FastAPI(lifespan=lifespan)` construction at line 101 that is
  already Vercel's expected entrypoint shape.
- `apps/telegram-router/app/tracing.py` - the app's tracing helper module
  (`with_span`, `mark_span_failed`). The new `flush_tracing()` belongs here, next to the
  helpers it is the counterpart of, rather than in a new module.
- `apps/telegram-router/pyproject.toml` - gains the explicit `[tool.vercel]` entrypoint.
  Already declares `requires-python = ">=3.13"`, which Vercel reads for the Python
  runtime; no dependency change is needed.
- `apps/telegram-router/package.json` - the thin `-tasks` workspace. `dev`/`start` keep
  uvicorn on 3003. **Do not add a `build` script**; nothing in this chore builds.
- `apps/telegram-router/app/routers/telegram_webhook.py` - the contract route. Read to
  confirm the middleware change cannot alter its always-200 behaviour. Not edited.
- `apps/telegram-router/app/routers/owner_nudges.py` - the other instrumented route,
  which can legitimately return 500. Read to confirm the middleware preserves its status
  code. Not edited.
- `apps/telegram-router/tests/conftest.py` - the `httpx.ASGITransport` client fixture.
  Note it does **not** run lifespan, so no real tracer provider is configured in tests;
  the new tests rely on that.
- `apps/telegram-router/tests/test_telegram_webhook.py` - existing webhook tests; the
  model for the new test file's fixture style.
- `apps/telegram-router/AGENTS.md` - gains the telemetry decision (flush-per-request,
  heartbeat removed) and the deployment shape, in its "Tracing" section.
- `apps/telegram-router/README.md` - gains a "Deployment" section (Vercel project,
  entrypoint, root directory, why there is no `vercel.json`, why there is no
  `requirements.txt`) and the `/api/health` route in "Routes".
- `apps/telegram-router/.env.example` - documents `ENVIRONMENT=production` already;
  update the `DEBUG_TRACING` / Axiom comments that reference the removed heartbeat.
- `apps/guest-communication-agent/src/instrumentation.ts` (lines 114-150) - the
  `flushTracing()` precedent whose contract this chore copies: no-op when no provider,
  swallow and log on failure. Read only.
- `docs/conditional-docs.md` - the documentation index; its `apps/telegram-router`
  entries describe the README/AGENTS split and need no new entry unless a new doc file
  is created (it is not).
- `AGENTS.md` (root) - the Python-workspace rules that constrain every command in this
  plan, in particular `--filter=./apps/telegram-router` path filtering and the ban on
  a `required-version` floor under `[tool.uv]`.

### New Files

- `apps/telegram-router/tests/test_tracing.py` - covers the two new behaviours that
  nothing currently covers: every request triggers a flush, and a failing flush does not
  change the response.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the context before touching anything

- Read `AGENTS.md` (root), `apps/telegram-router/AGENTS.md` and
  `apps/telegram-router/README.md`.
- Read `apps/guest-communication-agent/src/instrumentation.ts` lines 114-150 for the
  `flushTracing()` contract this chore mirrors.
- Confirm the baseline is green before editing:
  `yarn turbo run test --filter=./apps/telegram-router` (56 tests pass today).

### 2. Add `flush_tracing()` to `app/tracing.py`

- Add `asyncio` and `sys` imports and, from `opentelemetry.sdk.trace`, `TracerProvider`.
- Add two module constants near the top, with a comment explaining each number:
  - `REQUEST_FLUSH_TIMEOUT_MS = 2_000` - the per-request budget.
  - `SHUTDOWN_FLUSH_TIMEOUT_MS = 400` - stays inside Vercel's documented 500ms
    post-SIGTERM window.
- Add:

  ```python
  async def flush_tracing(timeout_millis: int = REQUEST_FLUSH_TIMEOUT_MS) -> None:
  ```

  It must:
  - Fetch `trace.get_tracer_provider()` and return immediately when it is not an SDK
    `TracerProvider` instance. Use `isinstance`, not `hasattr`/`getattr` - `getattr`
    returns `Any` and `mypy --strict` will not accept calling it. This is the
    equivalent of GCA's `if (!globalProvider) return` and is what makes the helper a
    no-op in tests, where `conftest.py`'s `ASGITransport` never runs the lifespan.
  - Run the flush off the event loop: `await asyncio.to_thread(provider.force_flush,
timeout_millis)`. `force_flush` is synchronous and blocks on the exporter's HTTP
    round trip; calling it directly would block the loop for the duration.
  - Wrap that in `try` / `except Exception as err` (add `# noqa: BLE001` for
    consistency with the existing broad catch in `telegram_webhook.py`) and, on
    failure, only `print(f"[tracing] flush_tracing failed: {err}", file=sys.stderr)`.
    **Never re-raise.** A flush failure must not turn a successful request into a
    failed HTTP response.

- Write the comment above it in the register the rest of this file uses: say why the
  helper exists (Vercel Function, `BatchSpanProcessor`'s timer is not guaranteed to fire
  before the instance goes), and that it is the counterpart of GCA's `flushTracing()`.

### 3. Flush after every request, in `app/main.py`

- Import `flush_tracing` from `app.tracing`, plus `Request` from `fastapi` and
  `Response` from `fastapi` (or `starlette.responses`) for the middleware's type
  annotations, and `Awaitable`/`Callable` from `collections.abc`.
- After `app = FastAPI(lifespan=lifespan)` and the two `include_router` calls, register:

  ```python
  @app.middleware("http")
  async def flush_tracing_middleware(
      request: Request, call_next: Callable[[Request], Awaitable[Response]]
  ) -> Response:
      response = await call_next(request)
      await flush_tracing()
      return response
  ```

- Comment it with the decision the issue asks to be stated explicitly: **middleware
  force-flush was chosen over `SimpleSpanProcessor`**, because it costs one Axiom round
  trip per request instead of one per span (a single webhook request emits up to three
  spans), it keeps `BatchSpanProcessor`'s batching inside a request, and it does not
  depend on the instance surviving the response. Note that it runs after `call_next`
  returns, so the handler's spans have already ended and are queued, and that it returns
  the untouched `response` object - the status code and body of both routes, including
  `owner_nudges.py`'s 500 branch and the webhook's always-200 rule, are unaffected.

### 4. Bound the shutdown flush in the lifespan

- In the `finally:` block of `lifespan`, before `provider.shutdown()`, call
  `provider.force_flush(SHUTDOWN_FLUSH_TIMEOUT_MS)` (synchronous here - the lifespan's
  teardown is not serving a request).
- Comment that Vercel caps shutdown cleanup at 500ms after SIGTERM and that logs printed
  during shutdown never reach the dashboard, so this path is a belt-and-braces backstop:
  the per-request middleware is what actually guarantees export, which is also why
  `provider.shutdown()`'s own default 30s flush cannot hang here - the queue is already
  empty.

### 5. Remove the heartbeat

- Delete `HEARTBEAT_INTERVAL_SECONDS` (line 21), the `heartbeat_task` declaration, the
  `if axiom_configured:` heartbeat block with its `_heartbeat()` coroutine and
  `asyncio.create_task` (lines 80-89), and the `heartbeat_task.cancel()` in the `finally`
  block (lines 96-97).
- Remove the now-unused `import asyncio` from `main.py` (ruff's `F401` is in the default
  rule set and will fail the lint gate otherwise). Keep `axiom_configured`; it is still
  used by the production guard.
- Replace the deleted comment block with a short one recording the decision and its
  reason: the heartbeat existed to feed an Axiom dead-man's-switch monitor, a Vercel
  Function only runs while serving a request, so the heartbeat could not fire reliably
  and the monitor it fed would alarm on a healthy system. Point at `GET /api/health` as
  the daemon-free replacement.

### 6. Add `GET /api/health`

- Add it directly in `app/main.py`, below the middleware, as a three-line route
  returning `{"ok": True}`. Do not create a new router module for one unauthenticated,
  zero-logic route, and do not instrument it with `with_span` - it must stay free enough
  to be polled on a schedule without filling the Axiom dataset.
- It carries no auth by design (it exposes nothing) and is deliberately _not_ one of the
  two contract routes; it is the target for the external uptime check that replaces the
  dead-man's-switch monitor.
- Comment it as such.

### 7. Declare the Vercel entrypoint in `pyproject.toml`

- Add, after the `[build-system]` block:

  ```toml
  [tool.vercel]
  entrypoint = "app.main:app"
  ```

- This matches what Vercel's filename detection would already find at `app/main.py`, but
  states it, per Vercel's own recommendation for new projects. An unknown `[tool.*]`
  table is inert for uv, hatchling, ruff, mypy and pytest.
- Do **not** add a `requirements.txt`, do **not** add a `vercel.json`, do **not** add
  `apps/telegram-router` to the root `pyproject.toml`'s `[tool.uv.workspace] exclude`
  list, and do **not** add a `required-version` floor under `[tool.uv]` anywhere (root
  `AGENTS.md` records why the last one breaks Vercel builds outright).

### 8. Write the tests

Create `apps/telegram-router/tests/test_tracing.py` with three tests. Follow
`test_telegram_webhook.py`'s style: `monkeypatch` fixtures, `httpx.AsyncClient` via the
`client` fixture from `conftest.py`, no network.

- `test_flush_runs_after_every_request` - monkeypatch `app.main.flush_tracing` with an
  `AsyncMock`, `GET /api/health` through the client, assert the mock was awaited once.
- `test_flush_failure_does_not_change_the_response` - monkeypatch `app.main.flush_tracing`
  with an `AsyncMock(side_effect=RuntimeError("axiom down"))`, then assert
  `GET /api/health` still returns 200 with `{"ok": True}`. This is the GCA contract
  restated as a test: the middleware's `await flush_tracing()` sits between the handler
  and the response, so a raising flush would otherwise surface as a 500.

  Note: the production `flush_tracing` swallows its own exceptions, so this test proves
  the middleware does not introduce a _new_ failure path even if the helper's own guard
  is ever weakened.

- `test_flush_tracing_is_a_noop_without_an_sdk_provider` - call
  `await flush_tracing()` directly with no lifespan run and assert it returns without
  raising. This pins the `isinstance` guard that keeps every existing test green.

Also add one assertion to the existing suite rather than a new file: in
`tests/test_telegram_webhook.py`, extend the unauthenticated-request test (or add one if
absent) so that `POST /api/telegram/webhook` with no `X-Telegram-Bot-Api-Secret-Token`
still returns 401 **and** `flush_tracing` still ran - proving the middleware wraps
rejected requests too and that the fail-closed auth is untouched.

### 9. Update `apps/telegram-router/AGENTS.md`

- Extend the existing **Tracing** section (do not create a new top-level file; root
  `AGENTS.md` reserves this file for behavioural rules only):
  - Every request force-flushes the tracer provider through the HTTP middleware in
    `app/main.py`; new routes get this for free and must not be given their own flush.
  - A flush must never change a response. If you touch the middleware, keep the swallow-
    and-log contract.
  - There is no heartbeat span any more, and no heartbeat task to re-add. Record the
    reason in one sentence (request-driven function, monitor would false-alarm) so the
    next agent does not "restore" it.
  - `GET /api/health` is unauthenticated and uninstrumented on purpose; do not wrap it
    in `with_span`.
- Keep it to behavioural rules. The deployment facts go in the README.

### 10. Update `apps/telegram-router/README.md`

- Add `GET /api/health` to the **Routes** section, with one line on what it is for.
- Add a **Deployment** section covering: Vercel project `ihas-telegram-router`, Root
  Directory `apps/telegram-router`, framework preset `Other`, the app deploys as a single
  Vercel Function with Fluid compute, entrypoint declared as `app.main:app` via
  `[tool.vercel]` in `pyproject.toml`, dependencies resolved from `pyproject.toml` (plus
  the repo-root `uv.lock` when the build context includes it) with no `requirements.txt`,
  and no `vercel.json` because nothing needs `maxDuration` or `excludeFiles` yet.
- Add one short paragraph on the telemetry consequence: spans are force-flushed per
  request, the heartbeat is gone, and liveness is an external uptime ping against
  `/api/health` rather than a dead-man's-switch on heartbeat spans.
- Note that the registered Telegram webhook URL is a contract: changing the deployed
  domain or the path silently stops every inbound update.

### 11. Update `.env.example`

- Adjust the Axiom comment block so it no longer describes the heartbeat task as the
  reason the dataset gets traffic.
- Make the `ENVIRONMENT` comment explicit that a Vercel deployment must set it to
  `production`.
- Do not add or remove any variable name; `#70` already removed the Sentry build-time
  trio from this file.

### 12. Clean the local `.env.production`

- `apps/telegram-router/.env.production` is gitignored (local, not part of the diff) but
  still carries `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and
  `ENABLE_EXPERIMENTAL_COREPACK` from the Next.js era, and is missing `ENVIRONMENT`.
  Remove the four dead keys and add `ENVIRONMENT=production` so the local file matches
  what the Vercel project should hold.
- This changes no tracked file and must not be committed. Mention it in the PR body as a
  local step, alongside the dashboard prerequisites.

### 13. Verify the preview deployment, and only then consider `vercel.json`

- After the branch is pushed and the human prerequisites are done, check the Vercel
  preview build log for `ihas-telegram-router`.
- Expected: Vercel detects Python from `pyproject.toml`, installs with uv, and serves
  `app.main:app` as one Function.
- Known risk to watch for: the thin `package.json` sitting in the Root Directory can make
  Vercel resolve the project as a Node app with no build script. **Only if the build log
  shows that misdetection**, add `apps/telegram-router/vercel.json` pinning the Python
  build explicitly, and say in the PR why it was needed. Do not add it pre-emptively -
  the issue is explicit about that.
- Then run the manual, deployment-only checks from the issue, against the preview or
  production domain, not locally:
  - `POST /api/telegram/webhook` with no `X-Telegram-Bot-Api-Secret-Token` → 401.
  - `POST /api/telegram/webhook` with the correct secret and an unrecognised body → 200.
  - `GET /api/health` → 200 `{"ok": true}`.
  - A real Telegram round trip: a `missing_info` nudge arrives with its `[ref:...]` tag,
    replying to it calls GCA's `/answer`, and the confirmation comes back.
  - A `send_booking_link` nudge renders the inline ✅/❌ buttons; tapping Approve acks
    the callback query, edits the original message, and calls GCA's `/approve`.
  - Axiom shows spans in the `telegram-router` dataset after a deployed request, with the
    same span names as before the port. This is the check that proves step 3 worked, and
    it only means anything against the deployment.
- `yarn dev` must still start uvicorn on 3003 for the ngrok gateway. Confirm by reading
  `apps/telegram-router/package.json`; **do not start a dev server** - port 3003 is owned
  by the webhook gateway in the main checkout and is registered with Telegram.

### 14. Run the validation commands

- Run every command in the **Validation Commands** section below and confirm each exits
  zero.

## Test Coverage

- `apps/telegram-router/tests/test_tracing.py` (new, pytest - this workspace is Python,
  so the repo's `*.unit.test.ts` / `*.browser.test.tsx` / Playwright layers do not apply;
  the equivalent cheapest layer here is a pytest unit test through the existing
  `httpx.ASGITransport` fixture, no network, no server):
  - `test_flush_runs_after_every_request` - catches a middleware that is registered but
    never reached, or one accidentally dropped in a later refactor. Nothing today
    asserts a flush happens at all.
  - `test_flush_failure_does_not_change_the_response` - catches the exact regression the
    GCA contract exists to prevent: a raising flush turning a 200 into a 500, which for
    the Telegram webhook would mean Telegram retrying every update.
  - `test_flush_tracing_is_a_noop_without_an_sdk_provider` - catches a guard weakened to
    `hasattr`/unconditional call, which would make all 56 existing tests start doing real
    flush work (or blow up) because `conftest.py` never runs the lifespan.
- `apps/telegram-router/tests/test_telegram_webhook.py` (extended) - one assertion that
  an unauthenticated webhook request still 401s and still passes through the middleware.
  Catches the fail-closed auth being reordered behind the flush.
- No test for the heartbeat removal: it is a deletion, and the existing suite already
  passes without ever starting the task (`ASGITransport` does not run the lifespan). A
  test asserting the absence of a task would test nothing real.
- No test for `pyproject.toml`'s `[tool.vercel]` entrypoint, the README/AGENTS updates,
  or the `.env` changes: pure configuration and documentation. Their only real verifier
  is the Vercel preview build in step 13.
- No Playwright spec: this chore does not touch `apps/website` and changes no
  user-visible browser flow.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. Run them
from the worktree root.

- `yarn prettier --check .` - formatting matches the repo config, so the commit hook will
  not reject the Markdown changes
- `uv run ruff format --check .` - Python formatting matches, the `py-format` commit hook
  and CI's Ruff format step both check this
- `yarn turbo run lint --filter=./apps/telegram-router` - Ruff passes for the workspace,
  and in particular proves the `asyncio` import was removed along with the heartbeat
- `yarn turbo run typecheck --filter=./apps/telegram-router` - `mypy --strict` is sound,
  and in particular proves the middleware's annotations and the `isinstance` provider
  guard type-check
- `yarn turbo run test --filter=./apps/telegram-router` - all pytest tests pass: the 56
  existing ones unchanged plus the new tracing tests
- `yarn knip` - no unused files, exports or dependencies were introduced
- `yarn turbo run lint` - the rest of the monorepo still lints, proving nothing in the
  shared config regressed
- `yarn turbo run typecheck` - the rest of the monorepo still type-checks
- `yarn turbo run test` - the full test suite passes, which is what the pre-push hook runs
- `uv sync --locked` - the uv lockfile still resolves against the edited
  `pyproject.toml`; CI runs exactly this and it will fail if `[tool.vercel]` was
  mis-placed or a dependency was accidentally touched

Note: there is no `build` task for this workspace. Turbo synthesizes `lint` and `test`
for a uv member and the thin `package.json` intentionally carries only
`dev`/`start`/`typecheck`/`format:check`, so `yarn turbo run build
--filter=./apps/telegram-router` reports `No tasks were executed` and exits 0. It proves
nothing; the Vercel preview build in step 13 is the real build gate.

## Notes

- **The one thing the diff cannot fix.** The Vercel check stays red until the framework
  preset is changed from `Next.js` to `Other` in the dashboard. If the preview is still
  failing after this branch lands, check that first, before assuming the code is wrong.
- **Why middleware and not `SimpleSpanProcessor`.** Both satisfy the issue. Middleware
  wins on round trips: one webhook request emits up to three spans
  (`webhook.telegram_update` plus a Telegram-API span plus a GCA-relay span), so
  `SimpleSpanProcessor` would triple the Axiom traffic and add per-span latency inside
  the request. Middleware also leaves the existing `BatchSpanProcessor` wiring, the
  `DEBUG_TRACING` console processor, and the production guard untouched. The decision
  must be stated in a comment, per the issue.
- **`force_flush` blocks.** Python's OTel `TracerProvider.force_flush` is synchronous and
  waits on the exporter's HTTP round trip. Running it inside `asyncio.to_thread` is not
  optional polish, calling it bare in async middleware stalls the whole event loop for
  every concurrent request.
- **Fluid compute does not save the batch processor.** Instance reuse means a flush
  _might_ land on a later invocation, but "might" is exactly the property the issue
  rejects. The middleware makes export a property of the request, not of the instance's
  lifetime.
- **Shutdown logs are invisible.** Vercel caps shutdown cleanup at 500ms after SIGTERM
  and does not surface logs printed during it, so do not rely on the lifespan's
  `finally` block for either flushing or diagnostics.
- **Ports are a contract.** 3003 must stay in `package.json`'s `dev`/`start`; the ngrok
  gateway on 3010 routes `/api/telegram/webhook` to it. Never start a second dev server
  for this app.
- **No `Co-Authored-By` trailer** in the commit, per root `AGENTS.md`. Conventional
  commit, e.g. `chore(telegram-router): deploy on Vercel and flush spans per request`.
- **Out of scope**, per the issue: moving to a container host, and
  `guest-communication-agent`'s own `setInterval` heartbeat, which has the same problem
  and deserves its own follow-up issue once this approach is settled. Do not fix GCA's
  heartbeat here.
