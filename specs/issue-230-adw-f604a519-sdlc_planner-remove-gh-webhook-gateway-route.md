# Chore: remove the /gh-webhook gateway route and the ADW trigger startup

## Metadata

issue_number: `230`
adw_id: `f604a519`
issue_json: `{"number":230,"title":"chore: remove the /gh-webhook gateway route and the ADW trigger startup"}`

## Chore Description

GitHub label events no longer travel through the ngrok tunnel. Since SBub/adw-toolkit#53 every
onboarded repo's Issues webhook (this repo's hook 680180167 included) points at the Supabase Edge
Function `github-webhook`. Nothing sends to `/gh-webhook` any more, so:

1. The `/gh-webhook` -> `localhost:8001` entry in `scripts/dev-webhook-gateway.ts`'s `ROUTES`
   table, and every comment in that file about GitHub, its HMAC header and the ADW trigger, is
   dead weight. The WhatsApp (`/api/webhook/whatsapp` -> 3005) and Telegram
   (`/api/telegram/webhook` -> 3003) routes, `GATEWAY_PORT = 3010`, the proxy logic and ngrok stay.
2. `scripts/dev-adw.sh` (`yarn dev:adw`) exists solely to bring up the GitHub -> ngrok -> gateway
   -> trigger path. Its preflight is about `uv`, the `adws/` symlink and `GITHUB_WEBHOOK_SECRET`; it
   locates the ADW route by parsing the gateway's `ROUTES` for a label containing `ADW` and refuses
   to start without it; its report is the GitHub Payload URL and a 401 self-test against the
   trigger. Once the trigger is gone the only things left are "start the gateway" and "start
   ngrok", both of which `yarn dev` in `apps/guest-communication-agent` (`scripts/dev.ts`) already
   does, adopting either one if it is already up, and `yarn dev:webhook-gateway` covers the gateway
   on its own. **Decision: delete `scripts/dev-adw.sh` and the root `dev:adw` script**, and remove
   every reference to them (the issue's "if nothing else is left for the script to do, remove it
   and its references").
3. Docs that describe the 8001 route or the ADW trigger behind the tunnel (`AGENTS.md` Ports,
   `.adw/project.md` Ports, the GCA feature doc) must instead say GitHub label events go to the
   Supabase Edge Function `github-webhook`, not the tunnel.

Out of scope: the GitHub hook itself (already switched) and the trigger's code in the toolkit
(`adws/` is a symlink into the toolkit; a follow-up toolkit issue removes it after this merges).
Do not touch anything under `adws/` or `.claude/commands/`.

## Relevant Files

Use these files to resolve the chore:

- `scripts/dev-webhook-gateway.ts` - the gateway. Remove the third `ROUTES` entry and rewrite the
  header comment for two webhooks (Twilio, Telegram) instead of three.
- `scripts/dev-adw.sh` - the ADW stack launcher. Deleted.
- `package.json` (root) - `"dev:adw": "./scripts/dev-adw.sh"` script line. Removed.
- `AGENTS.md` (root, line ~146, `## Ports`) - "(and to the ADW trigger on 8001)". Rewritten.
- `.adw/project.md` (line ~95, `## Ports`) - "and to the ADW webhook trigger on 8001". Rewritten;
  the nine `##` headings and their order must not change.
- `apps/guest-communication-agent/app_docs/feature-9e5b865a-dev-gateway-tunnel-adoption.md` - lines
  9-15, 74-79, 114-117, 121-126 describe `yarn dev:adw`, `scripts/dev-adw.sh` and the trigger on 8001.
- `apps/guest-communication-agent/scripts/dev.ts` - comments at ~91-93 and ~135-137 say the adopted
  gateway/tunnel "belongs to `yarn dev:adw`". Comment-only edits; the adoption logic stays, since a
  gateway or tunnel can still be already up (a second `yarn dev`, or one started by hand).
- `apps/guest-communication-agent/scripts/dev-adoption.ts` - header comment (lines 3-6) names
  `yarn dev:adw`. Comment-only edit.
- `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` - header comment (lines 5-9)
  names `yarn dev:adw`. Comment-only edit; no assertion changes.
- `docs/conditional-docs.md` - line ~315, the GCA feature doc condition "When running `yarn dev` and
  `yarn dev:adw` at the same time". Reworded. The `scripts/dev-webhook-gateway.ts` entry (~391-395)
  already describes only 3005 and 3003; leave it.
- `README.md` - "Local webhook testing" section (~111-128) already describes only Twilio and
  Telegram. Read to confirm; no change expected.
- `apps/guest-communication-agent/AGENTS.md` - read before editing GCA files (workspace rules).
- `knip.json` - `ignoreBinaries` lists `ngrok` and `uv`. Leave as is: `ngrok` is still spawned by
  GCA's `dev.ts`, and `uv` is outside this chore; knip is run in validation to prove nothing broke.
- `lefthook.yml` - confirms which checks run on commit (prettier, lint, typecheck, knip) and push
  (tests).

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the workspace rules

- Read `apps/guest-communication-agent/AGENTS.md` before editing anything under that app.

### 2. Remove the `/gh-webhook` route from the gateway

- In `scripts/dev-webhook-gateway.ts`, delete the `ROUTES` entry
  `{ prefix: "/gh-webhook", host: "localhost", port: 8001, label: "GitHub -> ADW webhook trigger" }`.
  Keep the other two entries, `GATEWAY_PORT = 3010`, `handleRequest` and the listener unchanged.
- Rewrite the header comment so it describes two inbound webhooks, not three:
  - "Twilio's WhatsApp webhook needs to reach apps/guest-communication-agent (port 3005) and
    Telegram's bot webhook needs to reach apps/telegram-router (port 3003): two different local
    services, one shared public hostname." Drop "GitHub's issue webhook needs to reach the ADW
    trigger (port 8001)".
  - In "How it works", drop GitHub's HMAC: Twilio's `X-Twilio-Signature` is computed over the raw
    body; forwarded headers are `X-Twilio-Signature` and `X-Telegram-Bot-Api-Secret-Token`; "breaks
    both verifications at once" rather than "all three".
  - In "Usage", drop "`uv run adws/adw_triggers/trigger_webhook.py` for the ADW trigger"; upstreams
    are started with `yarn dev` for the two apps.
  - Add one short sentence noting GitHub issue events do not come through here: they go to the
    Supabase Edge Function `github-webhook` (SBub/adw-toolkit#53).
  - "Adding a fourth inbound webhook" becomes "Adding another inbound webhook".
- Keep the existing comment style (JSDoc block, prose). No em-dashes in new prose; use commas,
  colons or parentheses.

### 3. Delete the ADW stack launcher

- `git rm scripts/dev-adw.sh`.
- Remove the `"dev:adw": "./scripts/dev-adw.sh",` line from root `package.json` `scripts`
  (keep valid JSON; `dev:webhook-gateway` stays).

### 4. Update GCA comments that name `yarn dev:adw`

- `apps/guest-communication-agent/scripts/dev.ts`:
  - ~line 91-93: the adopted gateway or tunnel "belongs to another process (a second `yarn dev`, or
    a gateway/tunnel started by hand with `yarn dev:webhook-gateway` / `ngrok`), so it is never
    signalled here and its exit is never fatal to this stack." Drop "whose listener is meant to stay
    up permanently".
  - ~line 135-137: replace "`yarn dev:adw` starts the same gateway and is meant to stay up
    permanently, so an existing listener..." with "another `yarn dev` or a hand-started
    `yarn dev:webhook-gateway` may already hold GATEWAY_PORT, so an existing listener on
    GATEWAY_PORT is adopted rather than fought over."
  - Comments only: no code change in this file.
- `apps/guest-communication-agent/scripts/dev-adoption.ts` lines 3-6: "Probes for the two repo-level
  processes `yarn dev` may find already running (the webhook gateway and the ngrok tunnel)...".
- `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` lines 5-9: "spawning a second
  tunnel for a domain another process already holds". No change to fixtures or assertions.

### 5. Update the docs

- `AGENTS.md` `## Ports`: replace "which routes by path prefix to them (and to the ADW trigger on
  8001), and Twilio and Telegram hold registered URLs against it" with "which routes by path prefix
  to them, and Twilio and Telegram hold registered URLs against it. GitHub label events do not use
  the tunnel: every onboarded repo's Issues webhook points at the Supabase Edge Function
  `github-webhook`." Re-wrap the paragraph to the file's line width.
- `.adw/project.md` `## Ports` first bullet: same change ("routes by path prefix to them. Twilio and
  Telegram hold registered URLs against it. GitHub label events go to the Supabase Edge Function
  `github-webhook`, not the tunnel."). Do not add, rename or reorder any `##` heading; verify there
  are still exactly nine (`grep -c '^## ' .adw/project.md` prints `9`).
- `apps/guest-communication-agent/app_docs/feature-9e5b865a-dev-gateway-tunnel-adoption.md`:
  - Add a short dated note right under the metadata block: "2026-10-08 (issue 230): `yarn dev:adw`
    and the gateway's `/gh-webhook` route to the ADW trigger on 8001 were removed; GitHub label
    events now go to the Supabase Edge Function `github-webhook`. Where this doc says the ADW stack,
    read: a gateway and tunnel already started by another process."
  - Overview (lines 9-15): replace "the ADW stack (`yarn dev:adw`)" with "a webhook gateway and
    ngrok tunnel were already running (another `yarn dev`, or ones started by hand)"; "can now run
    side by side" sentence refers to two `yarn dev` runs / a hand-started gateway.
  - What Was Built: "never takes down the ADW listener's public path" becomes "never takes down a
    gateway or tunnel it adopted".
  - How to Use (lines 74-79): step 1 becomes "With the gateway and tunnel already up (for example
    `yarn dev:webhook-gateway` and `ngrok http 3010 --domain=<reserved domain>`), run `yarn dev`...";
    step 3 becomes "The gateway on 3010 and the tunnel keep answering." (drop the ADW trigger on 8001).
  - Testing (line ~114): "run `yarn dev:adw` then `yarn dev`, and the reverse" becomes "start the
    gateway and tunnel by hand, then `yarn dev`, and the reverse".
  - Testing probe paragraph: "With the ADW stack up" becomes "With a gateway and tunnel up".
  - Notes (lines ~121-126): replace the `scripts/dev-adw.sh` references with a plain statement that
    an adopted process's death is not noticed by `dev.ts`; drop the "were not touched" bullet's
    `dev-adw.sh` half (keep that `dev-webhook-gateway.ts` was not touched by that change).
- `docs/conditional-docs.md` line ~315: reword to "When running two `yarn dev` stacks, or `yarn dev`
  alongside a hand-started gateway or tunnel, and wondering why one leaves the other's gateway and
  tunnel alone".
- No new documentation file, so no new `conditional-docs.md` entry.

### 6. Prove nothing references the removed pieces

- `git grep -n "gh-webhook\|8001\|trigger_webhook" -- ':!specs/' ':!*.lock'` returns nothing (the
  issue's acceptance check; `yarn.lock`/`uv.lock` excluded).
- `git grep -n "dev:adw\|dev-adw" -- ':!specs/'` returns nothing.
- `git grep -n -i "ADW trigger\|ADW webhook\|X-Hub-Signature" -- ':!specs/'` returns nothing.

### 7. Smoke-check the gateway still forwards both prefixes

- Never start a dev server for `telegram-router` or `guest-communication-agent` (profile:
  Protected), and never kill or reuse a process this run did not start.
- Check whether something already listens on 3010 (`nc -z 127.0.0.1 3010`). If it does, it is the
  developer's gateway: do not touch it, skip this step and say so in the report; steps 2 and 6 plus
  the code review carry the proof.
- If 3010 is free: start `yarn dev:webhook-gateway` in the background, confirm its startup log lists
  exactly two routes (`/api/webhook/whatsapp* -> http://localhost:3005`,
  `/api/telegram/webhook* -> http://localhost:3003`), then POST to each prefix on
  `http://localhost:3010`. Each must answer from the matching route: the upstream's response if
  that app happens to be running, otherwise `502` with `Upstream unreachable: <label>` naming the
  right app (proving the prefix was matched and forwarded). POST to `/gh-webhook` must answer `404`
  `No route configured for this path`. Stop the gateway process this step started (and only it).

### 8. Run the validation commands

- Run every command in `Validation Commands` below; all must pass.

## Test Coverage

No test needed: the change deletes one entry from a static route table in a side-effecting script
(`dev-webhook-gateway.ts` listens at module scope and has no test harness; adding one would mean
refactoring it, which is out of scope), deletes a shell launcher and its `package.json` alias, and
edits comments and documentation. No behaviour is added or changed for the two remaining routes.
The removal is proved by the `git grep` checks in step 6 and the gateway smoke check in step 7; the
existing `apps/guest-communication-agent/tests/scripts/dev-adoption.test.ts` still pins the adoption
rule (only its header comment changes). No E2E spec or review screenshots: no `website` flow is
touched.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `git grep -n "gh-webhook\|8001\|trigger_webhook" -- ':!specs/' ':!*.lock'` - the issue's acceptance check; must print nothing (exit 1 from git grep means no match, which is the pass).
- `git grep -n "dev:adw\|dev-adw" -- ':!specs/'` - no dangling reference to the deleted launcher; must print nothing.
- `grep -c '^## ' .adw/project.md` - must print `9`: the profile's heading contract is intact.
- `yarn turbo run typecheck --filter=./apps/guest-communication-agent` - GCA files edited (comments only) still typecheck.
- `yarn turbo run typecheck` - repo-wide typecheck, since `scripts/dev-webhook-gateway.ts` sits at the root outside any workspace filter.
- `yarn turbo run lint --filter=./apps/guest-communication-agent` - GCA lint still clean.
- `yarn prettier --check .` - formatting of the edited TS, JSON and Markdown (root `package.json`, `AGENTS.md`, `.adw/project.md`, docs).
- `yarn knip` - no unused file, script or binary left behind by removing `dev:adw` and `dev-adw.sh`.
- `yarn turbo run test --filter=./apps/guest-communication-agent` - `dev-adoption.test.ts` and the rest of GCA's unit tests still pass.
- `yarn turbo run build --filter=./apps/guest-communication-agent` - the build of the only workspace with edited source still succeeds.

## Notes

- Commit message: Conventional Commits, no scope (multi-workspace plus root config and docs), e.g.
  `chore: remove the /gh-webhook gateway route and the ADW trigger launcher`. No `Co-Authored-By`,
  "Generated with" or "Authored by" lines.
- Why delete `dev-adw.sh` rather than slim it: with the trigger gone, its preflight (uv, `adws/`
  symlink, `GITHUB_WEBHOOK_SECRET`), its route parse (it refuses to start without a `ROUTES` label
  containing `ADW`) and its whole report (GitHub Payload URL, 401 self-test) have nothing left to
  check. What remains, starting the gateway and the ngrok tunnel with adoption, is exactly what GCA's
  `yarn dev` already does, and `yarn dev:webhook-gateway` exists for the gateway alone.
- The follow-up toolkit issue removes `adws/adw_triggers/trigger_webhook.py`; this repo must merge
  first so nothing here still starts it.
- The root `.env.development` may still hold `GITHUB_WEBHOOK_SECRET`; it is an untracked local file,
  so leave it alone (never read or print secrets). Mention in the PR that the developer can drop it.
- `README.md` references `docs/ngrok-webhook-gateway-sop.md`, which does not exist in the repo; it
  predates this chore and is not in scope.
