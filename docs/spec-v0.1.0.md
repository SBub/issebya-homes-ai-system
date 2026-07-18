# Orch-A — v0.1.0 Spec

## Purpose

Orch-A is the orchestrator at the center of the issebya.homes automation system (see `docs/agent-architecture.mmd` for the full target-state org chart). v0.1.0 is the smallest slice of that chart that can run end-to-end: no delegate agents exist yet, so this version only reads system state and reports it — it does not yet act.

## Scope

**In scope for v0.1.0:**
- Orch-A core loop: Analyze → Report (Decide/Dispatch are structurally present but have nothing to dispatch to yet — see Non-goals)
- Two data sources: Availability, Finance
- System Health, scoped to exactly three checks (see below)
- Telegram Gateway reporting, with delivery confirmation

**Out of scope for v0.1.0 (Non-goals):**
- Any delegate agent (Property Mgmt, Guest-Comms, Campaign, Social, Ads, PR, Designer, SWE) — none are wired, so Decide/Dispatch have no real targets yet
- CRM tool — explicitly deferred, needs its own design pass
- Any write/action capability — v0.1.0 is read-and-report only, it changes nothing in the world
- Pricing/yield management, cron jobs (finance filing, cleaning schedule, etc.) — separate build tracks
- MCP — not used anywhere in this loop; see calling convention below

## Architecture

**Trigger model:** stateless, wake-on-trigger — not a persistent process. Two triggers:
1. **Heartbeat** — scheduled wake (cadence TBD, start with daily) for a routine analysis pass
2. **Event-driven** — reserved for later versions once there are agents/tools that can raise signals; no event sources exist yet in v0.1.0, so only the heartbeat is implemented now

**Loop, each wake:**
1. **Analyze** — pull current state from Availability and Finance
2. **Decide** — v0.1.0: no real decision to make (nothing to dispatch to); this step exists structurally so later versions slot in without a redesign, but for now it just formats what Analyze found into a report
3. **Dispatch** — no-op in v0.1.0 (no agents wired)
4. **Report** — always send a digest to Telegram: what Analyze found, any anomalies, confirmation the loop ran. Never optional, never silent.

## Components

### Orch-A core
- Language/framework: Python, Pydantic AI (`Agent` class + typed tools; agent-delegation-as-tool pattern reserved for when real agents exist)
- Runs as a scheduled job (not a long-lived server) — a crash on one run must not prevent the next scheduled run from executing normally

### Tools: Availability, Finance
- **Calling convention: direct, typed, no MCP.** MCP is reserved for human-facing dynamic tool discovery (e.g. the existing `issebya-homes-admin-mcp` in the website repo); Orch-A knows its fixed, small set of data sources at build time, so MCP's discovery/protocol overhead is unwarranted here.
- **Data access approach: read-only direct Postgres queries against Supabase**, not proxying through the website's or finance app's HTTP layers. Both Availability and Finance data already live in materialized tables/views (`booking_availability`, `finance_bookings`) — querying them directly avoids needing new API endpoints built into `apps/website` or `apps/finance` just to serve Orch-A, and keeps the read path simple. Use a read-only Supabase role/key scoped to only what Orch-A needs.
- Each tool returns a typed Pydantic model — no raw/untyped JSON passed around internally.

### System Health — scoped to exactly this version
Three checks only, nothing about agents/crons that don't exist yet:
1. Dead-man's switch on Orch-A's own heartbeat — did the scheduled run actually execute
2. Is Availability data reachable and fresh
3. Is Finance data reachable and fresh

### Reporting — Telegram Gateway
- Must confirm delivery (check the Telegram API response), not fire-and-forget
- On send failure: retry once, then fall back to a durable record (a table row, or equivalent) rather than swallowing the error — this is the one output v0.1.0 has, so it cannot fail silently
- Report content: state summary from Analyze, any Health check failures, confirmation the run completed

## Data / State

- Needs a minimal persistence layer for: last successful run timestamp (for the dead-man's switch), and a durable fallback record for failed Telegram deliveries
- No other state required at this scope — no queues, no agent memory, no conversation history

## Definition of Done for v0.1.0

- Scheduled heartbeat runs Orch-A without manual intervention
- Each run reads real Availability + Finance data (not mocked) via direct Supabase query
- A Telegram report is sent every run, with confirmed delivery or a visible fallback record on failure
- Health check correctly flags: a missed heartbeat, stale/unreachable Availability data, stale/unreachable Finance data
- A single crashed run does not prevent the next scheduled run from executing

## Open Questions

- Heartbeat cadence — daily to start, but not yet confirmed
- Supabase read-only role/key provisioning for this new repo/service — needs to be created and scoped
- Where this service actually runs/deploys (not yet decided — needs a host for a scheduled Python job)
