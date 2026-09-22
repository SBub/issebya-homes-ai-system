# Bug: `yarn dev` fails with ERR_NGROK_334 when the ADW stack is already running

## Metadata

issue_number: `90`
adw_id: `9e5b865a`
issue_json: `{"number":90,"title":"yarn dev fails with ERR_NGROK_334 when the ADW stack is already running — dev.ts must adopt the existing gateway and tunnel"}`

## Bug Description

`apps/guest-communication-agent/scripts/dev.ts` (what `yarn dev` runs for GCA, and
therefore what `turbo run dev` runs at the repo root) unconditionally starts two
repo-level processes it does not own:

- the webhook gateway (`yarn dev:webhook-gateway`, listening on `GATEWAY_PORT` 3010);
- the ngrok tunnel (`ngrok http --domain=<host> 3010`).

`scripts/dev-adw.sh` (`yarn dev:adw`) starts the same two processes, and is meant to
stay up permanently so GitHub webhook deliveries keep reaching the ADW trigger on 8001. There can only ever be one of each: the one reserved ngrok domain forwards to
one local port at a time, and 3010 can have one listener.

Symptom, reproduced 2026-09-21 09:49 with `dev:adw` up:

```
guest-communication-agent:dev: Starting ngrok tunnel on kerchief-coveted-remorse.ngrok-free.dev -> localhost:3010 (webhook gateway)...
guest-communication-agent:dev: ERROR:  failed to start tunnel: The endpoint 'https://kerchief-coveted-remorse.ngrok-free.dev' is already online.
guest-communication-agent:dev: ERROR:  ERR_NGROK_334
guest-communication-agent:dev: ngrok tunnel exited (code 1) — stopping the other dev processes...
website:dev: FATAL Error while authenticating with Stripe: ... context canceled
Failed:    guest-communication-agent#dev
```

Expected: `yarn dev` notices the gateway and the tunnel are already up, adopts both,
and starts only what is missing (`next dev`, `inngest dev`).

Actual: the second `ngrok` process is refused with `ERR_NGROK_334`, exits 1,
`dev.ts`'s `handleExit` treats that as fatal and tears down `next dev`, `inngest dev`
and the second gateway it also just tried to start — so `yarn dev` cannot start the
apps at all while the ADW stack is running. The Stripe `FATAL` and the
telegram-router shutdown in the log are consequences of that teardown, not separate
faults.

## Problem Statement

`dev.ts` has no adoption path for the two shared, repo-level processes. It already
adopts Supabase (`supabase status` → "Supabase already running.") but spawns the
gateway and the tunnel blindly, and then treats the resulting failure of a process it
should never have started as a reason to stop everything else. `yarn dev` and
`yarn dev:adw` are therefore mutually exclusive, in one direction only —
`dev-adw.sh` already adopts what it finds.

## Solution Statement

Give `dev.ts` the same "detect, adopt, never stop what I did not start" behaviour
`dev-adw.sh` already has, for exactly the two processes it does not own:

1. **Gateway** — probe `127.0.0.1:GATEWAY_PORT` with a short `node:net` TCP connect.
   A listener means the gateway is up: log one adoption line and do not spawn.
2. **Tunnel** — `GET http://127.0.0.1:4040/api/tunnels` (ngrok's local agent API,
   short timeout). Adopt only if some tunnel's `public_url` host equals the host
   derived from `TWILIO_WEBHOOK_URL` — Twilio's signature check in `route.ts`
   (`verifyTwilioSignature`) is computed against that exact public URL, so any other
   tunnel (different domain, agent with no tunnels, unreachable 4040) must fall
   through to starting our own, which then fails loudly if the domain really is taken
   elsewhere.

The matching logic goes in a small, pure, importable module so it can be unit-tested
without spawning anything; `dev.ts` keeps the process orchestration. Processes that
were not spawned by this run are simply never added to the shutdown/`handleExit`
wiring — they are `undefined` in `dev.ts`'s own bookkeeping, which is already how the
"ngrok skipped" case behaves today.

Nothing else changes: ports stay 3010/3005/3003, `dev-adw.sh` and
`dev-webhook-gateway.ts` are untouched, and `yarn dev` on a clean machine still
starts both processes itself and still stops them on Ctrl-C.

## Steps to Reproduce

1. Start the ADW stack from the main checkout: `yarn dev:adw` (gateway on 3010, ADW
   trigger on 8001, ngrok tunnel for the reserved domain → 3010).
2. In another shell, run `yarn dev` at the repo root (or
   `yarn workspace guest-communication-agent dev`).
3. GCA's `dev.ts` spawns a second `ngrok http --domain=<reserved domain> 3010`.
4. ngrok refuses it: `ERR_NGROK_334 — The endpoint 'https://<domain>' is already
online.`, process exits 1.
5. `handleExit("ngrok tunnel", ...)` fires, SIGTERMs `next dev`, `inngest dev` and the
   gateway it spawned, and `dev.ts` exits 1; turbo reports
   `Failed: guest-communication-agent#dev`.

Note for whoever executes this plan: steps 1–5 start GCA's dev server on 3005, which
this repo's agent rules forbid an agent from doing (3003/3005 are a live contract with
Telegram/Twilio and are owned by the main checkout). The automated proof of the fix is
the unit test below plus the read-only probe in `Validation Commands`; the full
two-order run-through in the issue's `Verification` section is a human step.

## Root Cause Analysis

Three things combine:

1. **Unconditional spawn of processes `dev.ts` does not own.** `dev.ts:82`-ish
   `spawn("yarn", ["dev:webhook-gateway"], { cwd: <repo root> })` and
   `startNgrokTunnel()`'s `spawn("ngrok", ["http", "--domain=<host>", "3010"])` both
   assume they are the only starter. They are not: `dev-adw.sh` starts the same two,
   and the ADW listener is meant to stay up permanently.
2. **Singleton resources.** One reserved ngrok domain forwards to one local port at a
   time (`dev.ts`'s own module comment at lines 8–12 says exactly this, naming
   `ERR_NGROK_334`), and 3010 admits one listener. So the second attempt cannot
   succeed — it is not a race or a timing issue.
3. **A non-owned process's failure is treated as fatal to the whole stack.**
   `handleExit` is wired to all four children identically, so the refused tunnel stops
   `next dev` and `inngest dev` too. Even after adoption this wiring must only cover
   processes this run spawned; killing an adopted gateway or tunnel would take the ADW
   listener's public path down.

`dev.ts` already has the shape of the fix for Supabase (`supabase status` →
"Supabase already running."), and `dev-adw.sh` has the precedent for these exact two
processes — `port_pid()` (line 172) and `ngrok_api()` (line 197) feeding
"already running — using it, not starting a second" (lines 301–333). The bug is that
one of the two scripts learned this and the other did not.

## Relevant Files

Use these files to fix the bug:

- `apps/guest-communication-agent/scripts/dev.ts` — the only file that needs behaviour
  changes: adopt the gateway and the tunnel, and keep shutdown scoped to spawned
  processes.
- `scripts/dev-adw.sh` — **read only, do not modify.** The precedent to match:
  `port_pid()` (line 172), `ngrok_api()` (line 197), the adoption/"not starting a
  second" logging at lines 301–333, and its "stops only what it started" cleanup.
- `scripts/dev-webhook-gateway.ts` — **read only, do not modify.** Source of truth for
  `GATEWAY_PORT = 3010` and the path-prefix route table; its header explains why the
  tunnel must point at 3010 and not at 3005.
- `apps/guest-communication-agent/src/app/api/webhook/whatsapp/route.ts` — read
  `verifyTwilioSignature` to confirm why the adopted tunnel's host must equal the
  `TWILIO_WEBHOOK_URL` host exactly.
- `apps/guest-communication-agent/.env.development` — where `TWILIO_WEBHOOK_URL` comes
  from (`dev` script loads it via `tsx --env-file=.env.development`).
- `apps/guest-communication-agent/AGENTS.md` — GCA conventions, notably the comment
  rule: comment genuine landmines only, no narrative/changelog comments.
- `apps/guest-communication-agent/tests/scripts/braintrust-scorers/tool-calling.scorer.test.ts`
  — the precedent for unit-testing a pure helper that lives under `scripts/`
  (`tests/scripts/...` mirroring the script path).
- `knip.json` — confirms `apps/guest-communication-agent` entry globs already include
  `scripts/**/*.ts` and `tests/**/*.test.ts`, so a new script module and its test need
  no knip config change.
- `AGENTS.md`, `docs/conditional-docs.md` (Cross-cutting constraints → ports/gateway
  entry) — the port contract this fix must not disturb.

### New Files

- `apps/guest-communication-agent/scripts/dev-adoption.ts` — the adoption probes,
  separated from `dev.ts` purely so the tunnel-matching rule is unit-testable
  (`dev.ts` calls `main()` at import time, so it cannot be imported from a test).
  Exports:
  - `findAdoptableTunnel(payload: unknown, host: string): AdoptableTunnel | undefined`
    — pure; no I/O.
  - `fetchNgrokTunnels(timeoutMs?: number): Promise<unknown>` — `fetch` of
    `http://127.0.0.1:4040/api/tunnels`, resolves `undefined` on any error/timeout.
  - `isPortListening(port: number, timeoutMs?: number): Promise<boolean>` —
    `node:net` connect probe against `127.0.0.1`.
- `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` — unit tests for
  `findAdoptableTunnel`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the context before changing anything

- Read `apps/guest-communication-agent/scripts/dev.ts` in full, including its module
  comment about `GATEWAY_PORT`/`ERR_NGROK_334` and `startNgrokTunnel`'s doc comment.
- Read `scripts/dev-adw.sh` lines 160–210 and 295–340 — `port_pid`, `ngrok_api`,
  `tunnel_addr`, and the three adoption branches with their exact log wording.
- Read `apps/guest-communication-agent/AGENTS.md` (comment conventions) and the
  header of `scripts/dev-webhook-gateway.ts`.
- Confirm the live shape of the ngrok agent API you are parsing, on a machine where a
  tunnel is up: `curl -s http://127.0.0.1:4040/api/tunnels`. Expected shape:
  `{"tunnels":[{"name":"...","public_url":"https://<host>","proto":"https","config":{"addr":"http://localhost:3010"}}]}`.

### 2. Add `scripts/dev-adoption.ts`

- Create `apps/guest-communication-agent/scripts/dev-adoption.ts` with no side effects
  at import time (nothing but declarations and exports).
- `export type AdoptableTunnel = { publicUrl: string; addr: string | undefined }`.
- `export function findAdoptableTunnel(payload: unknown, host: string): AdoptableTunnel | undefined`
  — pure. Defensive narrowing over `unknown` (no `any`, no casts that lie): return
  `undefined` unless `payload` is an object with an array `tunnels`. For each entry
  with a string `public_url`, parse it with `new URL(...)` inside a `try` and compare
  `url.host === host` (host, so a port difference is not silently ignored). Return the
  first match as `{ publicUrl, addr }`, where `addr` is `entry.config.addr` when it is
  a string, else `undefined`. Return `undefined` when nothing matches.
- `export async function fetchNgrokTunnels(timeoutMs = 1000): Promise<unknown>` —
  `fetch("http://127.0.0.1:4040/api/tunnels", { signal: AbortSignal.timeout(timeoutMs) })`,
  return `await response.json()` when `response.ok`, and `undefined` on a non-ok
  response or any thrown error (no agent running is the common case and must be
  silent, not a warning).
- `export async function isPortListening(port: number, timeoutMs = 500): Promise<boolean>`
  — `net.connect({ host: "127.0.0.1", port })`, resolve `true` on `connect` (destroy
  the socket first), `false` on `error` or `timeout`; `socket.setTimeout(timeoutMs)`.
  Guard against double-resolve.
- Comments: one short comment on `findAdoptableTunnel` stating the landmine — the
  adopted tunnel must be the `TWILIO_WEBHOOK_URL` host because Twilio's signature is
  computed against that exact public URL — and nothing narrative. Per GCA's AGENTS.md,
  do not restate facts already stated in `dev.ts`'s module comment.

### 3. Adopt the gateway in `dev.ts`

- Make `main` `async` and change the bottom-of-file call to
  `main().catch((error) => { console.error(error); process.exit(1); });` so a rejected
  probe cannot vanish silently.
- Before the gateway `spawn`, `await isPortListening(GATEWAY_PORT)`. When true, log
  `` `webhook gateway already listening on :${GATEWAY_PORT} — using it, not starting a second.` ``
  and leave `gatewayDev` as `undefined`; otherwise spawn exactly as today.
- Declare it as `const gatewayDev: ChildProcess | undefined = ...` (an
  `await`-guarded ternary or a small local helper), matching how `ngrokDev` is already
  `ChildProcess | undefined`.

### 4. Adopt the tunnel in `startNgrokTunnel`

- Make `startNgrokTunnel` `async` (returns `Promise<ChildProcess | undefined>`) and
  `await` it in `main`.
- Keep the existing early returns unchanged: missing `TWILIO_WEBHOOK_URL` warns and
  returns `undefined`; an unparseable URL warns and returns `undefined`.
- After `host` is derived and before the `commandExists("ngrok")` check, call
  `findAdoptableTunnel(await fetchNgrokTunnels(), host)`. On a match, log
  `` `ngrok tunnel for ${host} already online — using it, not starting a second.` ``
  and return `undefined`. If the matched tunnel's `addr` port is not `GATEWAY_PORT`,
  additionally `console.warn` that it forwards elsewhere and webhooks will not reach
  this stack — the same warning `dev-adw.sh` prints (lines ~330), since a
  host-matching tunnel pointed at the wrong port is the one adoption case that looks
  healthy and is not.
- No match (no agent, 4040 unreachable, only a different domain's tunnel) → fall
  through to today's `commandExists`/`spawn` path unchanged, so a genuinely taken
  domain still fails loudly.

### 5. Scope shutdown to processes this run spawned

- Build the managed list from the spawned children only:
  `const spawned = [nextDev, inngestDev, gatewayDev, ngrokDev].filter((p): p is ChildProcess => p !== undefined);`
- `shutdown(signal)` iterates `spawned` and calls `killGroup` — an adopted gateway or
  tunnel is not in the list and is never signalled.
- Register `handleExit` only for spawned children, each with
  `spawned.filter((p) => p !== self)` as its `others`. Use the existing labels
  (`"Next.js dev server"`, `"Inngest Dev Server"`, `"Webhook gateway"`,
  `"ngrok tunnel"`) so the terminal output is unchanged for the processes that are
  still managed. A small `register(child, label)` local keeps this from growing into
  four near-identical blocks.
- Verify by reading: with both adopted, only `nextDev` and `inngestDev` are in
  `spawned`, so Ctrl-C leaves the gateway, the tunnel and the ADW listener up.

### 6. Add the regression test

- Create `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts`
  importing `findAdoptableTunnel` from `../../scripts/dev-adoption`, following the
  style of `tests/scripts/braintrust-scorers/tool-calling.scorer.test.ts`
  (`describe`/`it`/`expect` from `vitest`, hand-written fixtures matching the real
  `/api/tunnels` shape).
- Cases:
  - a tunnel whose `public_url` host equals the `TWILIO_WEBHOOK_URL` host is returned,
    with its `config.addr` carried through — this is the case that stops the second
    spawn and therefore the one that fails against the unfixed code;
  - a tunnel on a different ngrok domain is **not** adopted (returns `undefined`) —
    the issue's negative test;
  - `{ "tunnels": [] }` (agent up, no tunnels) → `undefined`;
  - `undefined` payload (4040 unreachable / fetch failed) → `undefined`;
  - a malformed entry (missing `public_url`, or a `public_url` that is not a valid
    URL) → `undefined`, and does not throw;
  - a matching host whose `config.addr` points at a port other than 3010 is still
    returned but with that `addr`, so `dev.ts` can warn on it.

### 7. No browser coverage

- GCA is a webhook service with no browser surface, and this change is confined to a
  local dev script that never runs in CI or production. No Playwright spec in
  `apps/website/e2e/` and no `e2e/*.md` journey is warranted — adding one would test
  `apps/website`, which this change does not touch.

### 8. Check nothing else relied on the old behaviour

- `grep -rn "dev:webhook-gateway" --include=*.ts --include=*.json --include=*.sh .`
  (excluding `node_modules`) to confirm no other caller assumed `dev.ts` always starts
  the gateway.
- Confirm `knip.json` needs no change: `apps/guest-communication-agent`'s `entry`
  already lists `scripts/**/*.ts` and `tests/**/*.test.ts`, and `project` lists both,
  so the new module and its test are covered. Only add config if `yarn knip` actually
  complains.
- Do not touch `scripts/dev-adw.sh` or `scripts/dev-webhook-gateway.ts`.

### 9. Run the validation commands

- Run every command in `Validation Commands` below, in order, and make each pass.

## Test Coverage

`apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` — a
`tests/**/*.test.ts` vitest unit test running under GCA's existing vitest project
(GCA's convention; the `*.unit.test.ts` / `*.browser.test.tsx` split is
`apps/website`'s). It exercises `findAdoptableTunnel` against hand-written
`/api/tunnels` payloads.

What it catches: the "a live tunnel for the `TWILIO_WEBHOOK_URL` host is adoptable"
case does not exist in the unfixed code at all (the module is new, and the current
`dev.ts` always spawns), so it fails before the fix and passes after; and the
different-domain / empty / malformed cases pin the constraint that a _wrong_ tunnel
must never be adopted, which is the regression that would silently break Twilio
signature verification if someone later loosened the match to "any tunnel".

The process-orchestration half (spawn vs adopt, shutdown scoping) is not unit-tested:
proving it would mean spawning real ngrok/gateway/`next dev` processes, which this
repo's rules forbid an agent from doing for ports 3003/3005/3010, and a mocked
`node:child_process` test would assert the implementation back to itself rather than
the behaviour. That half is covered by the read-only probe below plus the human
two-order run-through in the issue's `Verification` section.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `yarn workspace guest-communication-agent exec tsx -e "import('./scripts/dev-adoption.ts').then(async (m) => { console.log('gateway listening on 3010:', await m.isPortListening(3010)); const t = m.findAdoptableTunnel(await m.fetchNgrokTunnels(), new URL(process.env.TWILIO_WEBHOOK_URL ?? 'https://example.invalid').host); console.log('adoptable tunnel:', t); })"`
  — read-only probe of the real machine state, starts no server and touches no port
  the gateway owns. With the ADW stack up it must print `gateway listening on 3010:
true` and an `adoptable tunnel` object whose `publicUrl` host matches
  `TWILIO_WEBHOOK_URL` — i.e. both adoption branches would fire, which is exactly what
  stops the second `ngrok` spawn and the `ERR_NGROK_334` teardown. With nothing
  running it must print `false` and `undefined`, i.e. `dev.ts` still starts both
  itself. Run it before the change too (it fails to resolve the module — the adoption
  path does not exist) to demonstrate the gap.
- `yarn prettier --check .` — formatting matches the repo config, so the commit hook
  will not reject it
- `yarn turbo run lint --filter=./apps/guest-communication-agent` — lint passes for the
  workspace
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent` — types are
  sound, including the `async main` / `ChildProcess | undefined` changes
- `yarn knip` — no unused files, exports or dependencies were introduced
- `yarn turbo run test --filter=./apps/guest-communication-agent` — unit tests pass,
  including the new `tests/scripts/dev-adoption.test.ts`
- `yarn turbo run build --filter=./apps/guest-communication-agent` — production build
  succeeds (the script is outside the Next build, but this proves nothing in `src/`
  regressed)

Human-only, on a machine where `dev-adw.sh` is available and 3003/3005 are free (an
agent must not run these — they start GCA's dev server on a port under live contract):

- `yarn dev:adw` first, then `yarn dev` → `yarn dev` logs both adoption lines, prints
  no `ERR_NGROK_334`, and brings up `next dev` + `inngest dev`. Ctrl-C on `yarn dev`
  leaves `lsof -iTCP:3010`, `curl 127.0.0.1:4040/api/tunnels` and `lsof -iTCP:8001`
  all still answering.
- `yarn dev` alone with nothing running → unchanged: it starts the gateway and the
  tunnel, and Ctrl-C stops them.
- Negative test: with an ngrok agent up whose only tunnel is for a different domain,
  `yarn dev` does not adopt it and attempts its own `ngrok http --domain=<host> 3010`.
  The automated stand-in is the different-domain case in `dev-adoption.test.ts`.
- `curl -X POST https://<domain>/gh-webhook -d '{}'` → `401` still, with `yarn dev` up
  alongside the ADW stack.

## Notes

- No new dependency. `node:net`, `fetch` and `AbortSignal.timeout` are all in Node 22+
  (`engines.node: ">=22.13.0"`), so nothing is added to `package.json` and `yarn knip`
  has nothing new to resolve. `knip.json`'s `ignoreBinaries` already lists `lsof` and
  `ngrok`, but this fix deliberately uses `node:net`/`fetch` rather than shelling out,
  per the issue.
- Why a separate `dev-adoption.ts` rather than exporting from `dev.ts`: `dev.ts` calls
  `main()` at module scope, so importing it from a test would start Supabase, three
  dev servers and a tunnel. The split is the minimum needed to make the tunnel-match
  rule testable; all process orchestration stays in `dev.ts`.
- Adoption intentionally makes an adopted process's death non-fatal to `yarn dev` —
  that is the point of "stops only what it started". If the ADW stack is later torn
  down while `yarn dev` runs, webhooks stop arriving without `dev.ts` noticing; that
  is the same failure mode `dev-adw.sh` already accepts and is out of scope here.
- `GATEWAY_PORT` stays duplicated between `dev.ts` and `scripts/dev-webhook-gateway.ts`
  — `dev.ts`'s module comment explains why that file cannot be imported (it is a bare
  side-effecting script). Do not "fix" that as part of this change.
- Out of scope, per the issue: any change to `dev-adw.sh`, the ADW toolkit or the
  gateway route table; the Stripe CLI version notice and the Stripe `FATAL` in the log
  (both teardown noise); making `dev-adw.sh` start the app servers.
