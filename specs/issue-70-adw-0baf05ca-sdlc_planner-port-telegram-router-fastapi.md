# Chore: Port apps/telegram-router from Next.js to FastAPI

## Metadata

issue_number: `70`
adw_id: `0baf05ca`
issue_json: `{"number":70,"title":"Port apps/telegram-router from Next.js to FastAPI","body":"See full issue body in the triggering command."}`

## Chore Description

`apps/telegram-router` is a thin Telegram webhook dispatcher: 7 source files, 2
routes, no database, no UI, no AI calls. Its only React surface is a
`layout.tsx` that exists because Next.js requires one. This chore replaces its
entire Next.js/TypeScript implementation with an equivalent FastAPI/Python
implementation, made possible now that #69 has landed the repo's uv/turbo
Python-workspace toolchain (root `pyproject.toml`, `.python-version`,
`uv.lock`, lefthook `py-*` hooks, CI's `uv sync`/`ruff format --check`
steps — all already in place with zero Python members).

This is a byte-for-byte behavioral port, not a redesign. Every contract listed
below is load-bearing and must survive unchanged:

- **Port 3003**, unchanged — `scripts/dev-webhook-gateway.ts` and Telegram's
  registered webhook URL both depend on it.
- **Route paths unchanged**: `POST /api/telegram/webhook`,
  `POST /api/owner-nudges`.
- **`AXIOM_DATASET` stays literally `telegram-router`** — the GCA-app-health
  dashboard queries this dataset name via an APL `union`.
- **Span names and attribute keys stay identical**: `webhook.telegram_update`,
  `webhook.telegram_update.rejected`, `owner_nudges.send`,
  `owner_nudges.send.rejected`, `telegram.send_message`,
  `telegram.answer_callback`, `telegram.edit_message`, `gca.relay.*`
  (`gca.relay.send_guest_message`, `gca.relay.answer_owner_nudge`,
  `gca.relay.answer_booking_link_approval`); attributes `telegram.branch`,
  `gca.reason_category`, `gca.conversation_id`, `gca.correlation_id`,
  `gca.approved`, `http.status_code`.
- **The webhook always returns 200 once authenticated**, on every branch
  including failures and the noop — a non-2xx makes Telegram retry the whole
  update. This means the webhook route body must be parsed and validated
  **manually inside the handler**, not via a FastAPI/Pydantic typed request
  body (which would 422 on a malformed body before the handler ever runs).
- **Telegram sends stay best-effort**: unset `TELEGRAM_BOT_TOKEN`/
  `TELEGRAM_CHAT_ID` no-ops and returns `{"ok": true}`; a delivery failure
  returns `{"ok": false, "error": ...}` and never raises. `send_with_retry` is
  exactly one retry, two attempts total.
- **Two distinct auth mechanisms, kept distinct**:
  `X-Telegram-Bot-Api-Secret-Token` vs `TELEGRAM_WEBHOOK_SECRET` on the
  webhook; `X-API-Key` vs `TELEGRAM_ROUTER_API_KEY` on owner-nudges. Both fail
  closed when the expected value is unset.
- **No DB, no idempotency guard** — do not add one.
- **Both correlation mechanisms stay as they are**: `callback_data`
  (`booking_approve:<id>` / `booking_reject:<id>`) for `send_booking_link`; a
  `[ref:<correlationId>]` tag for `missing_info`, regex-matched back out of
  `reply_to_message.text`. The ref token is opaque, not assumed UUID-shaped.
- **Message text stays byte-identical** — the `[ref:...]` tag's position (two
  newlines after the body, at the very end) and the `asked: "<reason>"`
  quoting are both load-bearing, since this app parses its own composed text
  back out of Telegram's reply-echo later.
- **`{ok: true}` from a relay call is not a delivery guarantee.**

One deliberate, issue-sanctioned behavior change: `owner-nudges`'s
hand-rolled `400` validation (eight `!x || typeof x !== "string"` checks)
becomes a Pydantic request model, so a malformed request now gets FastAPI's
own `422` instead of a hand-composed `400`. Neither Telegram nor GCA (the only
caller) branches on the exact status code or error-body shape of an
auth-rejection or validation-rejection response — only success-vs-failure and,
for the two `401` cases, the literal status code, which stays `401`.

## Relevant Files

Use these files to resolve the chore:

- `apps/telegram-router/AGENTS.md` — this app's behavioral rules (correlation
  mechanisms, dual auth, always-200, no dedup, tracing convention). Rewrite
  for Python; the "Tests import compiled-style `.js` paths" section becomes
  obsolete and is deleted; every other rule carries over unchanged in meaning.
- `apps/telegram-router/README.md` — routes, correlation-id scheme, setup.
  Rewrite the "Checks" section to `yarn turbo run <task> --filter=` form (a
  bare `yarn lint`/`yarn typecheck`/`yarn test` from inside the app directory
  no longer resolves the right turbo package once the workspace splits in
  two — see `AGENTS.md`'s Python section from #69).
- `apps/telegram-router/src/app/api/telegram/webhook/route.ts` — the
  webhook handler to port: `handleBookingLinkDecision`,
  `extractMissingInfoCorrelationId`/`extractMissingInfoQuestion` (regexes),
  `handleOwnerNudgeReply`, `handleCallbackQuery`, the top-level `POST`
  dispatch (auth → parse → branch → always-200).
- `apps/telegram-router/src/app/api/owner-nudges/route.ts` — the
  owner-nudges handler to port: auth, validation, the three
  `reasonCategory`-keyed message compositions (`missing_info`, `wants_human`,
  `send_booking_link`), the `[ref:...]` tag and inline-button construction.
- `apps/telegram-router/src/lib/telegram/telegram.ts` — `sendMessage`,
  `sendWithRetry`, `answerCallbackQuery`, `editMessageText`,
  `telegramConfigured`, plus the `TelegramUpdate`/`TelegramMessage`/
  `TelegramCallbackQuery`/`InlineButton` shapes to become `models.py`.
- `apps/telegram-router/src/lib/telegram/gca.ts` — `sendGuestMessage`,
  `answerOwnerNudge`, `answerBookingLinkApproval`: all three throw on missing
  config, return `{ok: false, error}` on a real relay failure.
- `apps/telegram-router/src/lib/telegram/auth.ts` — `verifyWebhookSecret`,
  `requireApiKey`: the two auth checks, both fail closed on an unset secret.
- `apps/telegram-router/src/lib/tracing.ts` — `withSpan`, `markSpanFailed`;
  the ambient-context nesting behavior (one root span per request, no
  Inngest-style explicit anchor threading) has a direct equivalent in Python's
  OpenTelemetry `context.attach`/`start_as_current_span`.
- `apps/telegram-router/src/instrumentation.ts` — the lifespan behavior to
  port into `app/main.py`: Axiom OTLP `BatchSpanProcessor`; hard failure when
  `AXIOM_TOKEN`/`AXIOM_DATASET` are unset **in production**; Sentry
  production-only; `DEBUG_TRACING=1` console exporter (dev only — spans carry
  reply text); the 5-minute heartbeat span. The `FilteringSpanProcessor` and
  `NEXT_INTERNAL_SPAN_NAMES`/`NEXT_ROUTE_SPAN_PATTERN` denylists are dropped —
  there are no Next.js framework spans left to filter, and this is one of the
  chore's two concrete simplification wins (the other is Pydantic replacing
  hand-rolled validation). Python's Sentry SDK has no equivalent of
  `@sentry/nextjs`'s auto-OTel-setup collision, so the
  `skipOpenTelemetrySetup`/`FilteringSpanProcessor` workaround this file
  carries has no Python counterpart to port at all — `sentry_sdk.init()` is a
  plain, independent call.
- `apps/telegram-router/tests/app/api/telegram/webhook/route.test.ts`,
  `tests/app/api/owner-nudges/route.test.ts`,
  `tests/lib/telegram/gca.test.ts`, `tests/lib/telegram/telegram.test.ts` —
  the four vitest files to port 1:1 to pytest, same cases (including
  unauthorized paths, the noop branch, and the `send_booking_link` "missing
  correlationId" case, ported as `422` instead of `400`).
- `apps/telegram-router/package.json` — current Next.js scripts/deps to
  replace with a thin `package.json` per the #69 convention.
- `apps/telegram-router/.env.example`, `.env.development`, `.env.production`
  — env vars to carry over unchanged, except dropping
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` (see Notes — decision:
  drop, do not repoint at `sentry-cli`).
- `apps/telegram-router/next.config.ts`, `src/app/layout.tsx`,
  `vitest.config.ts`, `eslint.config.mjs`, `tsconfig.json` — delete; no
  Python equivalent needed (the last three's job is absorbed by
  `pyproject.toml`'s `[tool.pytest.ini_options]`/ruff/mypy config).
- root `pyproject.toml` — remove `apps/telegram-router` from
  `[tool.uv.workspace] exclude` now that it will have its own `pyproject.toml`
  (leaving it excluded would remove the app from the uv workspace entirely,
  per #69's own documented trap in `AGENTS.md`).
- root `knip.json` — delete the `"apps/telegram-router"` entry from
  `workspaces`; knip has no Python support and this app drops out of its
  scope entirely (ruff/mypy replace its job for this workspace).
- `AGENTS.md` (root) — already documents the Python-workspace conventions
  this chore must follow (two-name rule, thin `package.json` script split,
  `--filter=./apps/<dir>` path-filtering requirement, exclude-list
  maintenance trap). No edits needed here; read it, don't change it.
- `README.md` (root) — cross-app picture. Read to confirm it needs no edits:
  the `apps/telegram-router` section already says "thin I/O layer" with no
  Next.js-specific wording, and the Run section's `yarn dev` / webhook-gateway
  instructions are unaffected (the thin `package.json`'s `dev` script keeps
  `yarn dev` working identically). Verify this during planning-review, not a
  task to skip.
- `docs/conditional-docs.md` — already lists `apps/telegram-router/AGENTS.md`
  and `README.md` as the two docs to read for this workspace; no entry
  changes needed (see docs check below).
- `lefthook.yml` — already has `py-format`/`py-lint`/`py-typecheck`
  `pre-commit` hooks (from #69) scoped to `*.py`; no change needed, just
  confirm they actually fire once real `.py` files exist here.
- `.github/workflows/ci.yml` — already runs `uv sync --locked`,
  `uv run ruff format --check .`, and `yarn turbo run lint|typecheck|test`
  repo-wide (from #69); no change needed, since none of those commands are
  scoped to a workspace list that needs updating.

### New Files

- `apps/telegram-router/pyproject.toml` — the app's uv workspace member
  manifest (`[project] name = "telegram-router"`, dependencies, dev group,
  build backend, tool config for pytest/mypy/ruff).
- `apps/telegram-router/app/__init__.py`
- `apps/telegram-router/app/main.py` — `FastAPI()` app, `lifespan` context
  manager (OTel provider setup, Sentry, heartbeat task), mounts both routers.
- `apps/telegram-router/app/models.py` — Pydantic models: `TelegramMessage`,
  `TelegramCallbackQuery`, `TelegramUpdate` (all fields optional/best-effort,
  matching the TS interfaces' minimal-shape contract), `OwnerNudgeRequest`
  (camelCase JSON aliases via `alias_generator=to_camel`, `populate_by_name`,
  and a `model_validator` enforcing `correlationId` is required when
  `reasonCategory == "send_booking_link"`).
- `apps/telegram-router/app/auth.py` — `verify_webhook_secret` and
  `require_api_key`, both async FastAPI dependencies. Each does its own header
  check; on failure, opens the `*.rejected` span, calls `mark_span_failed`,
  and raises `HTTPException(401)`. On success, returns `None` and opens no
  span itself (the caller's own route span covers the success path, same
  nesting shape as the TS version where `verifyWebhookSecret` runs
  outside/before `withSpan`).
- `apps/telegram-router/app/telegram.py` — `TelegramResult` (a small
  dataclass/TypedDict), `telegram_configured`, `send_message`,
  `send_with_retry`, `answer_callback_query`, `edit_message_text`, using
  `httpx.AsyncClient`.
- `apps/telegram-router/app/gca.py` — `send_guest_message`,
  `answer_owner_nudge`, `answer_booking_link_approval`, using
  `httpx.AsyncClient`; raise `RuntimeError` on missing config (mirrors the TS
  `throw new Error(...)`), return an ok/error result object on a real relay
  failure.
- `apps/telegram-router/app/tracing.py` — `with_span` (async context manager
  wrapping `tracer.start_as_current_span`, recording exceptions and setting
  `ERROR` status on the way out, re-raising) and `mark_span_failed` (accepts
  either a caught exception or a plain string, same overload shape as the TS
  version).
- `apps/telegram-router/app/routers/__init__.py`
- `apps/telegram-router/app/routers/telegram_webhook.py` — `POST
/api/telegram/webhook`. Reads the raw body itself (`await
request.body()`/`request.json()` wrapped in try/except, not a typed Pydantic
  request parameter) so a malformed body still reaches the always-200 noop
  branch instead of FastAPI's automatic 422.
- `apps/telegram-router/app/routers/owner_nudges.py` — `POST
/api/owner-nudges`, typed `OwnerNudgeRequest` Pydantic body (422 on
  validation failure is acceptable here — GCA is a trusted internal caller,
  not Telegram, and nothing needs the always-200 contract on this route).
- `apps/telegram-router/tests/__init__.py`
- `apps/telegram-router/tests/conftest.py` — an `httpx.AsyncClient` fixture
  built on `httpx.ASGITransport(app=app)` for driving the FastAPI app in
  tests, plus any shared env-var fixtures.
- `apps/telegram-router/tests/test_telegram_webhook.py` — ported from
  `tests/app/api/telegram/webhook/route.test.ts`.
- `apps/telegram-router/tests/test_owner_nudges.py` — ported from
  `tests/app/api/owner-nudges/route.test.ts`.
- `apps/telegram-router/tests/test_gca.py` — ported from
  `tests/lib/telegram/gca.test.ts`, using `respx` to stub `httpx` calls.
- `apps/telegram-router/tests/test_telegram.py` — ported from
  `tests/lib/telegram/telegram.test.ts`, using `respx`.
- `apps/telegram-router/package.json` (rewritten in place, not literally new)
  — thin: `"name": "telegram-router-tasks"`, `dev`/`start`/`typecheck`/
  `format:check` scripts shelling to `uv run ...`, no `lint`/`test` scripts
  (turbo synthesizes those from the `pyproject.toml` package's dev group).

## Step by Step Tasks

### 1. Scaffold the uv workspace member

- Create `apps/telegram-router/pyproject.toml`:
  - `[project] name = "telegram-router"`, `version = "0.1.0"`,
    `requires-python = ">=3.13"` (matches root `.python-version`).
  - `dependencies`: `fastapi`, `uvicorn[standard]`, `httpx`, `pydantic`,
    `sentry-sdk`, `opentelemetry-sdk`,
    `opentelemetry-exporter-otlp-proto-http` (version-floor each with the
    latest stable major at implementation time, consistent with how the root
    `pyproject.toml` pins `ruff>=0.16`/`mypy>=2.3`).
  - `[dependency-groups] dev = [...]`: `pytest`, `pytest-asyncio`, `respx`,
    `ruff`, `mypy` — all four are **required** here, not just `pytest`/`ruff`:
    without every one of them declared on this member specifically, turbo
    silently drops the corresponding task for this workspace (per #69's
    documented gotcha), regardless of what the root dev group declares.
  - `[build-system]`: `hatchling`, with
    `[tool.hatch.build.targets.wheel] packages = ["app"]` (this service is
    never published as a wheel — `uv build` isn't part of this chore's
    validation — but uv's workspace resolution still needs a valid build
    backend declared).
  - `[tool.pytest.ini_options]`: `asyncio_mode = "auto"`,
    `testpaths = ["tests"]`.
  - `[tool.mypy]`: `python_version = "3.13"`, `strict = true`,
    `explicit_package_bases = true` (matches the `--explicit-package-bases`
    flag lefthook's `py-typecheck` hook already passes).
  - `[tool.ruff]`: `target-version = "py313"`, a `line-length` consistent
    with the rest of the repo's formatting config.
- Remove `"apps/telegram-router"` from root `pyproject.toml`'s
  `[tool.uv.workspace] exclude` list.
- Run `uv lock` from the repo root; confirm it resolves `telegram-router`'s
  dependencies with no errors and commit the updated `uv.lock`.
- Run `uv run --package telegram-router python -c "import fastapi, httpx,
pydantic, sentry_sdk"` (or equivalent) to confirm the member resolves and
  its deps install.

### 2. Port the shared library modules (no cross-module dependencies yet)

- `app/tracing.py`: port `with_span`/`mark_span_failed` using
  `opentelemetry.trace.get_tracer(__name__)` (or a fixed tracer name
  `"telegram-router"`, matching the TS `trace.getTracer("telegram-router")`)
  and `tracer.start_as_current_span`.
- `app/models.py`: port the `TelegramMessage`/`TelegramCallbackQuery`/
  `TelegramUpdate` shapes and `OwnerNudgeRequest` (with the camelCase alias
  generator and the conditional-`correlationId` validator described above).
- `app/auth.py`: port `verify_webhook_secret`/`require_api_key` as FastAPI
  dependencies per the New Files description — same fail-closed-on-unset
  behavior, same header names, same span-on-rejection-only shape.
- `app/telegram.py`: port `telegram_configured`, `send_message`,
  `send_with_retry`, `answer_callback_query`, `edit_message_text`. Preserve:
  no-op `{"ok": True}` when unconfigured; catch-and-return (never raise) on a
  real delivery failure; `send_with_retry` is exactly one retry.
- `app/gca.py`: port `send_guest_message`, `answer_owner_nudge`,
  `answer_booking_link_approval`. Preserve: raise on missing config, return
  `{"ok": False, "error": ...}` on a real relay failure, never raise on that
  path.

### 3. Wire the routers and the FastAPI app

- `app/routers/telegram_webhook.py`: port `handleBookingLinkDecision`,
  `extractMissingInfoCorrelationId`/`extractMissingInfoQuestion` (same two
  regexes, ported to Python's `re`), `handleOwnerNudgeReply`,
  `handleCallbackQuery`, and the top-level `POST` handler. The handler calls
  `verify_webhook_secret` as a dependency; on success, parses the body
  manually inside a `with_span("webhook.telegram_update", ...)` block and
  branches exactly as the TS version does (`callback_query` →
  `telegram.branch=callback_query`; a reply carrying a recognized `[ref:...]`
  → `telegram.branch=owner_nudge_reply`; otherwise →
  `telegram.branch=noop`), always returning `{"ok": True}` with status 200.
- `app/routers/owner_nudges.py`: port the auth dependency call, the
  `OwnerNudgeRequest`-typed body, and the three `reasonCategory` message
  compositions verbatim (including the exact newline/emoji/quoting layout),
  wrapped in `with_span("owner_nudges.send", ...)`.
- `app/main.py`: construct `FastAPI(lifespan=lifespan)`, `include_router` for
  both routers, and implement `lifespan` as an `asynccontextmanager`:
  - Build a `TracerProvider` with a `BatchSpanProcessor` wrapping
    `OTLPSpanExporter` pointed at
    `https://{AXIOM_DOMAIN or "api.axiom.co"}/v1/traces` with the
    `Authorization`/`X-Axiom-Dataset` headers, when `AXIOM_TOKEN` and
    `AXIOM_DATASET` are both set.
  - If they're unset and this is production (however the app's own env
    convention signals that — mirror whatever `NODE_ENV`/equivalent this repo
    uses for Python, e.g. an `ENVIRONMENT` var), raise on startup — booting
    with zero observability in production must stay loud.
  - If `DEBUG_TRACING=1`, add a `SimpleSpanProcessor(ConsoleSpanExporter())`
    (dev-only, spans carry reply text).
  - `sentry_sdk.init(dsn=SENTRY_DSN, environment="production")`,
    production-only, only when `SENTRY_DSN` is set — no
    `skip_otel_setup`-style workaround needed (Python's Sentry SDK doesn't
    auto-install its own OTel provider the way `@sentry/nextjs` does).
  - Set the resource's service name to `"telegram-router"`.
  - Start a background `asyncio` task that ends a fresh
    `instrumentation.heartbeat` span every 5 minutes, only when the Axiom
    processor was actually configured; cancel it on shutdown.
  - `yield`, then flush/shutdown the tracer provider on exit.

### 4. Port the tests

- Add `tests/conftest.py` with an `httpx.AsyncClient(transport=
httpx.ASGITransport(app=app), base_url="http://test")` fixture.
- Port all four vitest files to pytest 1:1, same cases:
  - `test_telegram_webhook.py`: booking_approve/booking_reject callback
    handling (success, relay failure, relay exception), the
    reply-to-owner-nudge flow (non-reply falls through, unrelated reply falls
    through, `wants_human` reply falls through, opaque non-UUID ref token
    extraction, KB-write failure message, success message), unauthorized → 401.
  - `test_owner_nudges.py`: unauthorized → 401, missing-field validation
    (assert `422`, not `400` — see the sanctioned behavior change above),
    each `reasonCategory`'s exact composed text (including the `[ref:...]`
    tag position and its absence for `wants_human`), `send_booking_link`'s
    required-`correlationId` case (also `422`) and its button payload, the
    500-after-retry-exhausted case.
  - `test_gca.py`: all three functions' throw-when-unconfigured,
    success-path payload/headers, and failure-without-throwing cases, using
    `respx` to stub the `httpx` calls instead of vitest's `vi.stubGlobal`.
  - `test_telegram.py`: `telegram_configured`, `send_message` (no-op,
    success, HTTP failure, Telegram-level `ok: false`, buttons single/multi),
    `send_with_retry` (success-first, retry-once-then-succeed,
    retry-once-then-fail), `answer_callback_query`, `edit_message_text`.
- Run `uv run --package telegram-router pytest apps/telegram-router/tests`
  (or `cd apps/telegram-router && uv run pytest`) and confirm all pass.

### 5. Add the thin package.json and wire it into yarn

- Rewrite `apps/telegram-router/package.json` to the thin form:
  `"name": "telegram-router-tasks"` (must differ from the pyproject.toml's
  `"telegram-router"` — turbo refuses to start otherwise), `"private": true`,
  and exactly four scripts turbo does not synthesize for a uv package:
  - `"dev": "uv run uvicorn app.main:app --reload --port 3003"`
  - `"start": "uv run uvicorn app.main:app --port 3003"`
  - `"typecheck": "uv run mypy app"`
  - `"format:check": "uv run ruff format --check ."`
  - No `lint`/`test` scripts — turbo synthesizes those from the
    `pyproject.toml` package's dev group (`ruff`/`pytest`).
- Run `yarn install` so `yarn.lock` gets an entry for the renamed/rewritten
  `telegram-router-tasks` workspace.

### 6. Rewrite environment files

- In `.env.example`, `.env.development`, and `.env.production`: remove the
  `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` block and its comment
  (build-time source-map upload was a Next.js-specific step; see Notes for
  why this chore drops rather than replaces it). Keep every other variable
  and value unchanged — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ROUTER_API_KEY`,
  `GUEST_COMMUNICATION_AGENT_API_URL`, `GUEST_COMMUNICATION_AGENT_API_KEY`,
  `AXIOM_TOKEN`, `AXIOM_DATASET=telegram-router` (unchanged, literal),
  `AXIOM_DOMAIN`, `SENTRY_DSN`, `DEBUG_TRACING`.
- Lightly adjust the `SENTRY_DSN` comment's reference to
  `src/instrumentation.ts`'s Sentry block to point at `app/main.py`'s
  `lifespan` instead.

### 7. Delete the Next.js/TypeScript implementation

Delete:

- `apps/telegram-router/next.config.ts`
- `apps/telegram-router/src/app/layout.tsx`
- `apps/telegram-router/src/app/api/telegram/webhook/route.ts`
- `apps/telegram-router/src/app/api/owner-nudges/route.ts`
- `apps/telegram-router/src/lib/telegram/telegram.ts`
- `apps/telegram-router/src/lib/telegram/gca.ts`
- `apps/telegram-router/src/lib/telegram/auth.ts`
- `apps/telegram-router/src/lib/tracing.ts`
- `apps/telegram-router/src/instrumentation.ts`
- `apps/telegram-router/vitest.config.ts`
- `apps/telegram-router/eslint.config.mjs`
- `apps/telegram-router/tsconfig.json`
- `apps/telegram-router/tests/app/api/telegram/webhook/route.test.ts`
- `apps/telegram-router/tests/app/api/owner-nudges/route.test.ts`
- `apps/telegram-router/tests/lib/telegram/gca.test.ts`
- `apps/telegram-router/tests/lib/telegram/telegram.test.ts`
- The now-empty `apps/telegram-router/src/` tree in full (`src/app/`,
  `src/lib/`, and `src/` itself) and the now-empty `tests/app/`/`tests/lib/`
  directories (leave the new top-level `tests/` and its ported files).
- `apps/telegram-router/tsconfig.tsbuildinfo` if present on disk (gitignored,
  so this is local cleanup only, not a tracked change) and the local
  `apps/telegram-router/.next/` build directory (also gitignored/untracked —
  safe to remove, not required for `git status` to be clean).

### 8. Update root-level tooling that enumerates this workspace

- In root `knip.json`, delete the `"apps/telegram-router": { ... }` entry
  from `workspaces` — knip has no Python support, so this workspace is out of
  its scope from here on (ruff/mypy own the job knip did for this app).

### 9. Rewrite this workspace's own docs

- `apps/telegram-router/AGENTS.md`: keep every behavioral rule (no DB/no
  dedup, `{ok:true}` not a delivery guarantee, always-200-once-authenticated,
  the two distinct auth mechanisms, best-effort/no-op Telegram sends,
  tracing-wrap-new-call-sites), updating only the file paths and language
  references (`src/lib/telegram/gca.ts` → `app/gca.py`, etc.). Delete the
  "Tests import compiled-style `.js` paths, not `.ts`" section — it has no
  Python equivalent and is explicitly called out in the issue as obsolete.
- `apps/telegram-router/README.md`: update the "Setup and running" section's
  language references (this app now runs on `uv run uvicorn`, still port 3003) and rewrite the "Checks" section from bare `yarn lint`/`yarn
typecheck`/`yarn test` to:
  ```bash
  yarn turbo run lint --filter=./apps/telegram-router
  yarn turbo run typecheck --filter=./apps/telegram-router
  yarn turbo run test --filter=./apps/telegram-router
  ```
  (the bare form no longer resolves correctly once the workspace splits into
  two turbo packages at one directory — see root `AGENTS.md`'s Python
  section). Routes and the correlation-id scheme prose are otherwise
  unchanged.
- `apps/telegram-router/CLAUDE.md`: no change (`@AGENTS.md`, already correct).
- Confirm root `README.md` needs no edits (its `apps/telegram-router`
  section and Run/webhook-gateway instructions are already framework-agnostic
  and remain accurate — `yarn dev` still starts this app via its thin
  `package.json`'s `dev` script).
- Confirm `docs/conditional-docs.md` needs no edits — its
  `apps/telegram-router` entries name `AGENTS.md`/`README.md` by path, not by
  framework, and both continue to exist at the same paths.

### 10. Final validation

- Run every command in `Validation Commands` below and confirm all pass.
- Manually smoke-test locally (do NOT start a second dev server if one is
  already running on 3003 — the port is owned by the shared webhook gateway
  per repo rules): `yarn turbo run dev --filter=./apps/telegram-router` only
  if nothing is already bound to 3003, then confirm `uvicorn` boots without
  the production Axiom-required-in-prod check firing (dev/test `ENVIRONMENT`
  should not trip it) and that `DEBUG_TRACING=1` prints spans to stdout as
  expected from `.env.development`.

## Test Coverage

This is not `apps/website`, so `*.unit.test.ts`/`*.browser.test.tsx`/
`apps/website/e2e/*.spec.ts` don't apply — this workspace's regression layer
is its own pytest suite, driven through `httpx.ASGITransport` against the
real FastAPI app, exactly mirroring how the existing vitest suite drives the
real Next.js route handlers. Each ported file proves something the deleted
vitest file proved and that no other layer in this repo covers:

- `tests/test_telegram_webhook.py` — proves the webhook's branching contract
  survives the port: booking-link approve/reject correctly relays and edits
  the message, a missing_info reply correctly extracts the opaque ref token
  and question text via regex, an unrelated/non-ref reply and a
  `wants_human` reply both fall through to noop, and every branch (including
  auth rejection and relay failure) still returns/records the right thing.
  Without this file, a regex or branch-order mistake introduced during the
  port (e.g. matching the wrong reply, or missing the always-200 contract on
  a failure branch) would ship silently.
- `tests/test_owner_nudges.py` — proves the three `reasonCategory` message
  compositions stay byte-identical (especially the `[ref:...]` tag's exact
  position, which GCA-side code and the webhook's own regex both depend on)
  and that `send_booking_link`'s required-`correlationId` rule and inline
  buttons survive the port. Without this file, a subtly wrong newline count
  or emoji in a composed message would break the round-trip correlation
  silently (no compiler catches a wrong string).
- `tests/test_gca.py` — proves each relay function's throw-vs-return contract
  (missing config throws; a real HTTP failure returns `{"ok": False,
"error"}` without throwing) and exact request shape (URL, headers, JSON
  body) against GCA's real routes survive the port to `httpx`.
- `tests/test_telegram.py` — proves the Telegram Bot API client's
  best-effort/no-op-when-unconfigured contract, the exact retry count in
  `send_with_retry`, and the inline-keyboard payload shape survive the port
  to `httpx`.

No test is needed for `app/tracing.py`/`app/auth.py`/`app/main.py`'s lifespan
wiring in isolation: `tracing.py`'s `with_span`/`mark_span_failed` and
`auth.py`'s two dependencies are exercised indirectly through every route
test above (auth via the 401 cases, tracing via the span-attribute
assertions already present in the ported webhook/owner-nudges tests), and
`main.py`'s OTel/Sentry bootstrap is infrastructure wiring with no
assertable output short of a live Axiom/Sentry integration — the existing TS
`instrumentation.ts` had no dedicated test either, for the same reason.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn prettier --check .` - Formatting matches the repo config (Python
  files are prettier-ignored, unaffected either way)
- `uv run ruff format --check .` - No badly-formatted Python, including the
  new `apps/telegram-router` code
- `uv run ruff check .` - Ruff lint passes repo-wide
- `yarn turbo run lint --filter=./apps/telegram-router` - Ruff lint passes
  for this workspace specifically (the `pyproject.toml` package)
- `yarn turbo run typecheck --filter=./apps/telegram-router` - mypy passes
  for this workspace (path filter required — the name filter would silently
  resolve only the `-tasks` package or vice versa and report a false green)
- `yarn knip` - No unused Node files/exports/dependencies were introduced,
  and the deleted `apps/telegram-router` knip entry doesn't break the run
- `yarn turbo run test --filter=./apps/telegram-router` - The full ported
  pytest suite passes
- `yarn turbo run build --filter=./apps/telegram-router` - Confirms no build
  task is unexpectedly required/broken for this workspace (turbo synthesizes
  `build` for the uv package trivially; the `-tasks` package has none)
- `uv sync --locked` - Committed `uv.lock` is current and installs cleanly
  with the new `telegram-router` member present
- `yarn install --immutable` - Committed `yarn.lock` is current after the
  `package.json` rewrite
- `yarn turbo run lint && yarn turbo run typecheck && yarn turbo run test` -
  Full repo-wide gates stay green (confirms nothing else in the monorepo
  regressed, e.g. GCA's own references to this app's routes/env vars)

## Notes

- **SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT decision: drop, don't
  repoint at `sentry-cli`.** These three existed only for
  `next.config.ts`'s `withSentryConfig()` build-time source-map upload;
  Python has no equivalent build step, and no other app in this repo has set
  up a `sentry-cli`-based release/source-map workflow yet to model this on.
  Revisit if/when this app's stack traces in Sentry turn out to need
  source-mapping (Python tracebacks are generally readable without it, unlike
  minified JS).
- The webhook route's manual (non-Pydantic-typed) body parsing is the single
  most load-bearing implementation detail in this port: getting it wrong
  (e.g. typing the request body as a Pydantic model on that specific route)
  silently breaks the always-200 contract and would make Telegram retry
  every malformed/unrecognized update indefinitely.
- Do not add a database, a dedup/idempotency check, or any persistence — the
  issue and this app's own `AGENTS.md` are explicit that this is
  intentional, not a gap.
- Deployment (Vercel vs. a container host, and the `BatchSpanProcessor`/
  heartbeat concerns a serverless target would raise) is explicitly out of
  scope, per the issue. This chore leaves the app running locally and in CI
  only, same as today.
- `uv run --package telegram-router ...` vs. `cd apps/telegram-router && uv
run ...` are equivalent from a uv workspace; use whichever is more
  convenient during implementation, both resolve the same environment.
