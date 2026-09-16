#!/usr/bin/env bash
#
# One command for the whole inbound path a GitHub issue travels down before an
# ADW run starts:
#
#   GitHub  ->  ngrok (reserved public hostname)
#           ->  webhook gateway      scripts/dev-webhook-gateway.ts  :3010
#           ->  ADW webhook trigger  adws/adw_triggers/trigger_webhook.py  :8001
#
# Why this exists: that path is three separate long-running processes started in
# three terminals in a particular order, and every way of getting it wrong fails
# as a symptom that points somewhere else. ngrok pointed at an app's port
# instead of the gateway gives 404s that look like a bad webhook registration.
# The trigger not running gives 502s that look like the tunnel being down. A
# missing GITHUB_WEBHOOK_SECRET gives 401s that look like the wrong secret on
# GitHub's side (deliberately so — the trigger returns an identical
# `{"status":"unauthorized"}` for "no secret configured" and "bad signature", so
# as not to tell an unauthenticated caller which one it is). Starting the stack
# the same way every time, and naming the failure that actually happened, is the
# entire point of this file.
#
# What this does NOT start: any application dev server. `yarn dev` (turbo) runs
# apps/website, apps/telegram-router and apps/guest-communication-agent; this
# runs the webhook plumbing. They are independent — the ADW trigger does not
# need the apps, and the apps do not need this. Nor does it touch Supabase.
#
# Ports and hostname — where the truth lives:
#   GATEWAY_PORT and the ADW route (path prefix + upstream port) are READ OUT OF
#   scripts/dev-webhook-gateway.ts at startup rather than repeated here, because
#   that file is where they are a contract with the outside world and a copy
#   here would be a copy that silently goes stale. If the parse below stops
#   matching that file, this script refuses to start rather than falling back to
#   a remembered value — a stale port is exactly the bug this avoids.
#   NGROK_DOMAIN is the one thing that genuinely has no in-repo source: it is a
#   reserved hostname on the ngrok account. AGENTS.md ("Ports are a contract")
#   and docs/ngrok-webhook-gateway-sop.md document it in prose; this constant is
#   its only executable copy.
#
# Reuse, not restart: any of the three may already be up — that is how they are
# run by hand today. Anything already listening is detected, reported and used
# as-is. This never starts a second one and never kills one it did not start; on
# exit it stops only its own children.
#
# Usage: `yarn dev:adw` from the repo root (or run this file directly).
#        Ctrl+C shuts down everything this script started.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_SRC="$REPO_ROOT/scripts/dev-webhook-gateway.ts"
TRIGGER_SRC="adws/adw_triggers/trigger_webhook.py" # relative to REPO_ROOT on purpose: `uv run` is invoked from there
ENV_FILE="$REPO_ROOT/.env.development"

# The reserved ngrok hostname for this repo. Free plan: one agent, one tunnel,
# and this hostname comes back every session — which is why Twilio's, Telegram's
# and GitHub's registrations are one-time and must never be re-pointed at an
# app's port. See the header.
NGROK_DOMAIN="kerchief-coveted-remorse.ngrok-free.dev"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  C_OFF=$'\033[0m'
  C_DIM=$'\033[2m'
  C_OK=$'\033[32m'
  C_WARN=$'\033[33m'
  C_ERR=$'\033[31m'
  C_GATEWAY=$'\033[36m'
  C_ADW=$'\033[35m'
  C_NGROK=$'\033[34m'
else
  C_OFF="" C_DIM="" C_OK="" C_WARN="" C_ERR="" C_GATEWAY="" C_ADW="" C_NGROK=""
fi

say() { printf '%s[dev-adw]%s %s\n' "$C_DIM" "$C_OFF" "$*"; }
ok() { printf '  %sok%s    %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[dev-adw] warning:%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die() {
  printf '%s[dev-adw] cannot start:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2
  exit 1
}

# Prefix every line a child prints so three interleaved streams stay readable.
# awk rather than `sed -u` because BSD sed (macOS) has no -u, and rather than a
# log multiplexer because this repo does not add a dependency for this kind of
# thing.
prefix_stream() { awk -v p="$1" '{ printf "%s%s\n", p, $0; fflush() }'; }

# ---------------------------------------------------------------------------
# Reading the gateway's port table
# ---------------------------------------------------------------------------

GATEWAY_PORT="$(sed -nE 's/^const GATEWAY_PORT = ([0-9]+);.*/\1/p' "$GATEWAY_SRC" 2>/dev/null | head -1)"

# The ROUTES entry whose label names ADW: take its prefix and upstream port.
# Anchored on the label rather than on the port number so that renaming the path
# or moving the trigger's port is picked up here for free.
read -r ADW_PREFIX ADW_PORT <<<"$(
  awk '
    /prefix:/ { p = $0; sub(/.*prefix: "/, "", p); sub(/".*/, "", p); prefix = p }
    /port:/   { q = $0; gsub(/[^0-9]/, "", q); port = q }
    /label:/ && /ADW/ { print prefix, port; exit }
  ' "$GATEWAY_SRC" 2>/dev/null
)"

# ---------------------------------------------------------------------------
# Process bookkeeping
# ---------------------------------------------------------------------------

STARTED_PIDS=()
STARTED_LABELS=()
ADOPTED=() # human-readable list of things that were already up

# Kill a process and everything below it, deepest first. `yarn dev:webhook-gateway`
# is yarn -> tsx -> node and `uv run ...` is uv -> python: killing only the
# wrapper leaves the real listener holding the port, which is the orphan this
# script exists not to create.
kill_tree() {
  local pid=$1 sig=$2 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return
  CLEANED=1
  trap - INT TERM EXIT

  if [ ${#STARTED_PIDS[@]} -eq 0 ]; then
    printf '\n'
    say "nothing to stop — every process was already running and is left alone."
    return
  fi

  printf '\n'
  say "stopping the ${#STARTED_PIDS[@]} process(es) this script started..."
  local i pid
  for i in "${!STARTED_PIDS[@]}"; do
    pid="${STARTED_PIDS[$i]}"
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid" TERM
    else
      say "  ${STARTED_LABELS[$i]} had already exited"
    fi
  done

  # Give them a moment to go down politely, then insist.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local alive=0
    for pid in "${STARTED_PIDS[@]}"; do
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = 0 ] && break
    sleep 0.3
  done
  for i in "${!STARTED_PIDS[@]}"; do
    pid="${STARTED_PIDS[$i]}"
    if kill -0 "$pid" 2>/dev/null; then
      say "  ${STARTED_LABELS[$i]} did not stop on SIGTERM, sending SIGKILL"
      kill_tree "$pid" KILL
    fi
  done
  say "done. Anything that was already running before this script started is untouched."
}

# PID listening on a TCP port, empty if none.
port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

spawn() {
  local label=$1 color=$2
  shift 2
  ("$@" 2>&1 | prefix_stream "${color}[${label}]${C_OFF} ") &
  STARTED_PIDS+=("$!")
  STARTED_LABELS+=("$label")
  # Drop the job from bash's job table: we track it by PID and report its exit
  # ourselves, and without this bash also prints its own "Terminated: 15" line
  # over the top of a tidy shutdown.
  disown 2>/dev/null || true
}

wait_for_port() {
  local port=$1 label=$2 tries=${3:-100} # tries * 0.2s
  local i
  for ((i = 0; i < tries; i++)); do
    [ -n "$(port_pid "$port")" ] && return 0
    sleep 0.2
  done
  die "$label never started listening on :$port — see its output above."
}

# ngrok's local agent API. Its presence is also how we know an agent is up.
ngrok_api() { curl -fsS --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null; }
json_field() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
tunnel_url() { ngrok_api | json_field public_url; }
tunnel_addr() { ngrok_api | json_field addr; }

# ---------------------------------------------------------------------------
# Preflight — only the checks whose absence fails confusingly later
# ---------------------------------------------------------------------------

say "preflight"

[ -f "$GATEWAY_SRC" ] || die "$GATEWAY_SRC is missing — this script reads its port table from it."

if [ -z "$GATEWAY_PORT" ] || [ -z "${ADW_PORT:-}" ] || [ -z "${ADW_PREFIX:-}" ]; then
  die "could not read the port table out of scripts/dev-webhook-gateway.ts.
         Expected a line 'const GATEWAY_PORT = <n>;' and a ROUTES entry whose
         label mentions ADW. That file changed shape; update the parse at the
         top of scripts/dev-adw.sh rather than hardcoding the ports here."
fi
ok "gateway source  :$GATEWAY_PORT, ADW route ${ADW_PREFIX}* -> :$ADW_PORT  ${C_DIM}(read from scripts/dev-webhook-gateway.ts)${C_OFF}"

command -v ngrok >/dev/null 2>&1 || die "ngrok is not on PATH. Install it (brew install ngrok) and log in to the
         account holding the reserved domain $NGROK_DOMAIN."
ok "ngrok           $(command -v ngrok)"

command -v uv >/dev/null 2>&1 || die "uv is not on PATH. The ADW trigger is a uv inline-script
         (#!/usr/bin/env -S uv run) and cannot run without it — see
         https://docs.astral.sh/uv/getting-started/installation/."
ok "uv              $(command -v uv)"

# adws/ is a symlink to a private toolkit checked out separately. On a fresh
# clone of this repo it is simply absent (.gitignore: "ADW toolkit — symlinked
# in from a private repo, never committed here"), and the symptom without this
# check is `uv run` complaining about a path, which does not explain itself.
if [ ! -e "$REPO_ROOT/$TRIGGER_SRC" ]; then
  if [ -L "$REPO_ROOT/adws" ]; then
    die "adws/ is a symlink to $(readlink "$REPO_ROOT/adws"), which does not resolve.
         The ADW toolkit is a separate private checkout; clone it there, or
         re-point the symlink: ln -sfn <path-to>/adw-toolkit/adws adws"
  fi
  die "$TRIGGER_SRC not found. adws/ is a symlink to a private ADW toolkit
         checkout that this repo never commits; create it with
         ln -s <path-to>/adw-toolkit/adws adws"
fi
ok "adws/           -> $(cd "$REPO_ROOT/adws" && pwd -P)"

# The secret. python-dotenv does not override an already-exported variable, so
# an exported value genuinely wins over the file and counts here.
if [ ! -f "$ENV_FILE" ] && [ -z "${GITHUB_WEBHOOK_SECRET:-}" ]; then
  die ".env.development not found at $ENV_FILE.
         The root .env.development holds ADW configuration (AGENTS.md,
         'Environment files'); without it the trigger has no
         GITHUB_WEBHOOK_SECRET and rejects every delivery with 401."
fi

secret_source=""
if [ -n "${GITHUB_WEBHOOK_SECRET:-}" ]; then
  secret_source="exported in this shell"
elif [ -f "$ENV_FILE" ]; then
  # Value only — never printed, only tested for emptiness.
  if [ -n "$(sed -nE 's/^[[:space:]]*GITHUB_WEBHOOK_SECRET[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" |
    tail -1 | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' | tr -d '[:space:]')" ]; then
    secret_source=".env.development"
  fi
fi

# Refusing rather than warning-and-continuing is a deliberate choice. Every
# GitHub delivery is HMAC-signed and the trigger rejects an unverifiable one
# with a body that is identical to the bad-signature case, so a stack started
# without the secret looks completely healthy from here — three processes up, a
# green tunnel — while every issue event dies at the door, and the only place the
# failure is visible is GitHub's own delivery log. That is the exact
# looks-like-something-else failure this script exists to prevent, and the fix is
# one line in a file we can name. A warning would be the right call for something
# optional or slow to fix; this is neither.
if [ -z "$secret_source" ]; then
  die "GITHUB_WEBHOOK_SECRET is not set (looked in $ENV_FILE and the environment).
         Without it every GitHub delivery is rejected 401 by the trigger, and the
         rejection is deliberately indistinguishable from a bad signature — so the
         stack would come up looking perfectly healthy and quietly do nothing.
         Add it to .env.development with the same value as the webhook's secret in
         the repo's GitHub settings, then run this again."
fi
ok ".env            GITHUB_WEBHOOK_SECRET set ${C_DIM}($secret_source)${C_OFF}"

cd "$REPO_ROOT" || die "cannot cd to $REPO_ROOT"

# ---------------------------------------------------------------------------
# Start, in dependency order: gateway, then the trigger behind it, then the
# tunnel in front. ngrok is useless without the gateway listening; the gateway
# answers 502 rather than dying when the trigger is not up yet, but starting it
# first means the very first delivery works too.
# ---------------------------------------------------------------------------

# Installed only now: a preflight failure has started nothing, so it has nothing
# to tear down and should not print a teardown line. INT and TERM exit
# explicitly — a trap handler that just returns would drop us back into the
# monitor loop below and Ctrl+C would appear to do nothing.
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap cleanup EXIT

printf '\n'

if [ -n "$(port_pid "$GATEWAY_PORT")" ]; then
  say "webhook gateway already listening on :$GATEWAY_PORT (pid $(port_pid "$GATEWAY_PORT")) — using it, not starting a second."
  ADOPTED+=("webhook gateway")
else
  say "starting webhook gateway on :$GATEWAY_PORT ..."
  spawn gateway "$C_GATEWAY" yarn dev:webhook-gateway
  wait_for_port "$GATEWAY_PORT" "webhook gateway"
fi

if [ -n "$(port_pid "$ADW_PORT")" ]; then
  say "ADW webhook trigger already listening on :$ADW_PORT (pid $(port_pid "$ADW_PORT")) — using it, not starting a second."
  ADOPTED+=("ADW webhook trigger")
else
  say "starting ADW webhook trigger on :$ADW_PORT ..."
  # PORT comes from the gateway's route table, so the trigger cannot end up on a
  # port the gateway is not proxying to. python-dotenv does not override an
  # exported variable, so this wins over .env.development.
  spawn adw "$C_ADW" env PORT="$ADW_PORT" uv run "$TRIGGER_SRC"
  wait_for_port "$ADW_PORT" "ADW webhook trigger"
fi

if pgrep -f '[n]grok ' >/dev/null 2>&1 || [ -n "$(ngrok_api)" ]; then
  existing_addr="$(tunnel_addr)"
  say "an ngrok agent is already running — using it, not starting a second (the free plan allows one)."
  ADOPTED+=("ngrok tunnel")
  if [ -n "$existing_addr" ] && [ "${existing_addr##*:}" != "$GATEWAY_PORT" ]; then
    warn "that tunnel forwards to $existing_addr, NOT to the gateway on :$GATEWAY_PORT.
          GitHub deliveries will not reach the ADW trigger until it is re-pointed.
          Stop it and re-run this script, or restart it as:
            ngrok http $GATEWAY_PORT --domain=$NGROK_DOMAIN"
  fi
else
  say "starting ngrok tunnel $NGROK_DOMAIN -> :$GATEWAY_PORT ..."
  spawn ngrok "$C_NGROK" ngrok http "$GATEWAY_PORT" --domain="$NGROK_DOMAIN" --log=stdout
  for _ in $(seq 1 60); do
    [ -n "$(tunnel_url)" ] && break
    sleep 0.5
  done
  [ -n "$(tunnel_url)" ] || die "ngrok started but never published a tunnel — see its output above.
         ERR_NGROK_334 here means another agent already holds $NGROK_DOMAIN."
fi

PUBLIC_URL="$(tunnel_url)"
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="https://$NGROK_DOMAIN"
PAYLOAD_URL="${PUBLIC_URL}${ADW_PREFIX}"
# Where the tunnel actually forwards, as ngrok reports it — not where we would
# have pointed it. With a reused agent those can differ, and the summary below
# should not claim otherwise.
TUNNEL_TARGET="$(tunnel_addr)"
[ -n "$TUNNEL_TARGET" ] || TUNNEL_TARGET="http://localhost:$GATEWAY_PORT"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

started_note() {
  local name=$1 item
  for item in "${ADOPTED[@]:-}"; do
    [ "$item" = "$name" ] && {
      printf '%salready running, left alone%s' "$C_DIM" "$C_OFF"
      return
    }
  done
  printf '%sstarted by this script%s' "$C_OK" "$C_OFF"
}

printf '\n'
say "ADW webhook stack ready"
printf '\n'
printf '  webhook gateway      http://localhost:%s   %s\n' "$GATEWAY_PORT" "$(started_note 'webhook gateway')"
printf '  ADW webhook trigger  http://localhost:%s   %s\n' "$ADW_PORT" "$(started_note 'ADW webhook trigger')"
printf '  public tunnel        %s -> %s   %s\n' "$PUBLIC_URL" "$TUNNEL_TARGET" "$(started_note 'ngrok tunnel')"
printf '\n'
printf '  GitHub webhook Payload URL (Settings -> Webhooks), content type application/json:\n'
printf '    %s\n' "$PAYLOAD_URL"
printf '\n'
printf '  Confirm the path end to end without waiting for a real issue event:\n'
printf "    curl -sS -o /dev/null -w '%%{http_code}\\\\n' -X POST %s \\\\\n" "$PAYLOAD_URL"
printf "      -H 'Content-Type: application/json' -d '{}'\n"
printf '    %s401%s the request reached the trigger and was rejected as unsigned — the whole path works\n' "$C_OK" "$C_OFF"
printf '    %s502%s tunnel and gateway fine, nothing answering on :%s\n' "$C_WARN" "$C_OFF" "$ADW_PORT"
printf '    %s404%s ngrok is pointed at something that is not the gateway, or the route prefix moved\n' "$C_WARN" "$C_OFF"
printf '\n'

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$PAYLOAD_URL" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null)"
case "$code" in
401) printf '  %s✓%s ran it just now: %s — end to end, GitHub -> ngrok -> gateway -> trigger.\n' "$C_OK" "$C_OFF" "$code" ;;
"") printf '  %s?%s ran it just now: no response. The tunnel may still be coming up; try the curl above.\n' "$C_WARN" "$C_OFF" ;;
*) printf '  %s!%s ran it just now: %s, expected 401. See what that means above.\n' "$C_WARN" "$C_OFF" "$code" ;;
esac

printf '\n'
if [ ${#STARTED_PIDS[@]} -eq 0 ]; then
  say "everything was already running; this script started nothing, so Ctrl+C will stop nothing."
else
  say "Ctrl+C stops the ${#STARTED_PIDS[@]} process(es) this script started. Logs below are prefixed by source."
fi
printf '\n'

# ---------------------------------------------------------------------------
# Hold the terminal. Not `wait`: when everything was already running there is
# nothing to wait on, and the script still has to stay up so Ctrl+C is the way
# out. If something we started dies on its own, say which and tear down the rest
# rather than leaving half a stack up pretending to work.
# ---------------------------------------------------------------------------

while :; do
  for i in "${!STARTED_PIDS[@]}"; do
    if ! kill -0 "${STARTED_PIDS[$i]}" 2>/dev/null; then
      warn "${STARTED_LABELS[$i]} exited on its own — shutting the rest down."
      exit 1
    fi
  done
  sleep 1
done
