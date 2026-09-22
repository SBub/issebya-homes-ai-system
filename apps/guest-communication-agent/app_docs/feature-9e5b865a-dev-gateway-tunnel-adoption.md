# Dev script adopts an existing webhook gateway and ngrok tunnel

**ADW ID:** 9e5b865a
**Date:** 2026-09-21
**Specification:** `specs/issue-90-adw-9e5b865a-sdlc_planner-adopt-existing-gateway-tunnel.md`

## Overview

`yarn dev` used to fail outright whenever the ADW stack (`yarn dev:adw`) was already
running: GCA's `scripts/dev.ts` unconditionally spawned a second webhook gateway on
3010 and a second ngrok tunnel for the one reserved domain, ngrok refused the tunnel
with `ERR_NGROK_334`, and that exit tore down `next dev` and `inngest dev` with it.
`dev.ts` now probes for both shared processes first, adopts them when they are already
up, and only ever signals the children it spawned itself. `yarn dev` and `yarn dev:adw`
can now run side by side in either order.

## What Was Built

- A probe module, `scripts/dev-adoption.ts`, holding the three side-effect-free helpers
  `dev.ts` needs to decide "spawn or adopt".
- Gateway adoption: a TCP connect probe against `127.0.0.1:3010`. A listener means the
  gateway is up, so `dev.ts` logs one adoption line and skips the spawn.
- Tunnel adoption: a read of ngrok's local agent API at `http://127.0.0.1:4040/api/tunnels`,
  adopting only a tunnel whose public host equals the `TWILIO_WEBHOOK_URL` host.
- A warning for the one adoption case that looks healthy and is not: a host match whose
  `config.addr` forwards somewhere other than the gateway port.
- Shutdown scoped to spawned processes only, so Ctrl-C on `yarn dev` never takes down
  the ADW listener's public path.
- A vitest unit test pinning the tunnel-match rule.

## Technical Implementation

### Files Modified

- `apps/guest-communication-agent/scripts/dev-adoption.ts` (new): exports
  `findAdoptableTunnel(payload, host)` (pure, defensive narrowing over `unknown`),
  `fetchNgrokTunnels(timeoutMs = 1000)` (resolves `undefined` on any error or timeout)
  and `isPortListening(port, timeoutMs = 500)` (a `node:net` connect probe). No imports
  beyond `node:net`, no side effects at import time.
- `apps/guest-communication-agent/scripts/dev.ts`: `main`, `startNgrokTunnel` and the
  extracted `startWebhookGateway` became async; both shared processes are now
  `ChildProcess | undefined`; shutdown and `handleExit` wiring were rebuilt around a
  single `spawned` list.
- `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` (new): eight cases
  over hand-written `/api/tunnels` fixtures.

### Key Changes

- The gateway spawn moved out of `main` into `startWebhookGateway()`, which returns
  `undefined` after logging
  `webhook gateway already listening on :3010 — using it, not starting a second.`
  when the port already has a listener.
- `startNgrokTunnel()` checks `findAdoptableTunnel(await fetchNgrokTunnels(), host)`
  after deriving the host from `TWILIO_WEBHOOK_URL` and before the `commandExists("ngrok")`
  check. A match logs `ngrok tunnel for <host> already online — using it, not starting a second.`
  and returns `undefined`; anything else (no agent, 4040 unreachable, only a foreign
  domain's tunnel) falls through to the unchanged spawn path, so a genuinely taken
  domain still fails loudly.
- Host matching is exact (`new URL(publicUrl).host === host`), because Twilio's
  signature check in `src/app/api/webhook/whatsapp/route.ts` is computed against that
  exact public URL. Adopting any other tunnel would turn a loud startup failure into
  every inbound webhook silently failing verification.
- `const spawned = [nextDev, inngestDev, gatewayDev, ngrokDev].filter(...)` is now the
  single source for both `shutdown()` and the per-child `handleExit` registration via a
  local `register(child, label)`. An adopted process is `undefined`, so it is absent
  from that list and is never signalled, and its exit is never fatal to this stack.
- `main()` is awaited at the bottom of the file with a `.catch` that logs and exits 1,
  so a rejected probe cannot vanish silently.

## How to Use

Nothing to configure. The behaviour is automatic:

1. With the ADW stack already up (`yarn dev:adw`), run `yarn dev` at the repo root or
   `yarn workspace guest-communication-agent dev`.
2. Both adoption lines appear in the log and only `next dev` and `inngest dev` start.
   No `ERR_NGROK_334`.
3. Ctrl-C on `yarn dev` stops only those two. The gateway on 3010, the tunnel and the
   ADW trigger on 8001 keep answering.
4. On a clean machine, `yarn dev` behaves exactly as before: it starts the gateway and
   the tunnel itself, and stops both on Ctrl-C.

If the log shows `that tunnel forwards to <addr>, NOT to the gateway on :3010`, the
adopted tunnel points at the wrong local port and webhook calls will not reach this dev
stack until it is re-pointed.

## Configuration

No new environment variables, no new dependency. `node:net`, `fetch` and
`AbortSignal.timeout` are all available on the repo's Node floor (>=22.13.0).

- `TWILIO_WEBHOOK_URL` (from `apps/guest-communication-agent/.env.development`) is still
  the source of the tunnel host, and is now also what the adoption rule matches against.
  Unset means the tunnel is skipped, exactly as before.
- `GATEWAY_PORT` stays at 3010 in `dev.ts`, still deliberately duplicated from
  `scripts/dev-webhook-gateway.ts` (a bare side-effecting script that cannot be imported).

## Testing

- `yarn turbo run test --filter=./apps/guest-communication-agent` runs
  `tests/scripts/dev-adoption.test.ts`, which covers the host match (with `config.addr`
  carried through), a different ngrok domain, an empty `tunnels` array, an `undefined`
  payload, malformed entries, and a host match pointed at the wrong port.
- Read-only probe of the real machine state, which starts nothing and touches no port
  the gateway owns:

  ```
  yarn workspace guest-communication-agent exec tsx -e "import('./scripts/dev-adoption.ts').then(async (m) => { console.log('gateway listening on 3010:', await m.isPortListening(3010)); const t = m.findAdoptableTunnel(await m.fetchNgrokTunnels(), new URL(process.env.TWILIO_WEBHOOK_URL ?? 'https://example.invalid').host); console.log('adoptable tunnel:', t); })"
  ```

  With the ADW stack up it prints `true` and an adoptable tunnel object; with nothing
  running, `false` and `undefined`.

- The spawn-versus-adopt orchestration itself is a human check: run `yarn dev:adw` then
  `yarn dev`, and the reverse. It is not automated because proving it would mean starting
  GCA's dev server on 3005, a port under a live contract with Twilio that agents must not
  occupy.

## Notes

- Adoption deliberately makes an adopted process's death non-fatal to `yarn dev`. If the
  ADW stack is torn down mid-session, webhooks stop arriving without `dev.ts` noticing.
  That is the same trade `scripts/dev-adw.sh` already accepts and was out of scope here.
- `scripts/dev-adw.sh` and `scripts/dev-webhook-gateway.ts` were not touched. The former
  already had this behaviour (`port_pid`, `ngrok_api`, its "not starting a second"
  logging); this change gives `dev.ts` the matching half.
- The probes live in their own module only because `dev.ts` calls `main()` at module
  scope, so importing it from a test would start Supabase, three dev servers and a
  tunnel. All process orchestration stays in `dev.ts`.
