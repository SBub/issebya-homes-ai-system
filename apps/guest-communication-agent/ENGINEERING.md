# Guest Communication Agent: Engineering Overview

A production WhatsApp agent that handles guest communication for a small property
business: pricing, availability, property Q&A, and booking-link handoff, with a human
owner kept in the loop for anything that touches money or requires judgment calls the
model shouldn't make alone.

This document is a technical walkthrough of how the system is built, the parts I'd
want a reviewer to look at closely: the tool-calling loop, the durability model, where
and why humans intercept the agent, how generated code is sandboxed, and how the whole
thing is evaluated before it ships.

Stack: Next.js (API routes) + TypeScript, Vercel AI SDK for the model loop, OpenRouter
as the model gateway, Inngest for durable execution, Supabase/Postgres + pgvector for
storage and retrieval, Braintrust for evals/prompt management/tracing, Vercel Sandbox
for isolated code execution, Twilio for WhatsApp transport, Telegram for owner
notifications and approvals.

## 1. Overview

An inbound WhatsApp message hits `POST /api/webhook/whatsapp`, which verifies the
Twilio HMAC signature and immediately hands off to Inngest; the webhook itself does
no agent work and returns fast. A background Inngest function then runs the actual
agent turn: load conversation context → model call → zero or more tool calls → final
reply → send via Twilio.

The agent loop itself (`src/agent/run-agent-turn.ts`) is a plain async tool-calling loop, not
a graph or state machine.

### Tools

| Tool                       | Purpose                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `get_pricing`              | Nightly rate lookup                                                                                                        |
| `check_availability`       | Checks a room against booked date ranges via a live API                                                                    |
| `answer_property_question` | Embeds the guest's question and runs a pgvector similarity search over a knowledge base (house rules, amenities, policies) |
| `send_booking_link`        | Builds the booking URL (**requires human approval**, see §5)                                                               |
| `get_current_date`         | Grounds the model in today's date/day-of-week                                                                              |
| `run_code`                 | Lets the model write and execute a short script instead of chaining many tool calls (**runs in a remote sandbox**, see §6) |
| `wants_human`              | One-way escalation ping to the owner (no approval loop, informational)                                                     |
| `missing_info`             | Suspends the turn and asks the owner a question when the agent doesn't know the answer (see §2)                            |

Two tools intercept for a human: `send_booking_link` (blocking approval: the model
cannot proceed without an explicit yes) and `missing_info` (blocking on an answer, not
a yes/no: the turn can't produce a final reply until it has one).

## 2. The `missing_info` loop

When the agent hits a question it can't answer from context or the knowledge base, it
calls `missing_info` instead of guessing. That triggers:

1. A Telegram message to the owner with the guest's question and a correlation ID.
2. The Inngest run suspends on `step.waitForEvent`, waiting for the owner's answer
   event, bounded by a 24h timeout.
3. When the owner replies (matched back to the correlation ID from the Telegram
   message text), their answer is embedded and written straight into the same
   pgvector `documents` table the knowledge base lives in (tagged with its source)
   _before_ the waiting run is woken up, so the answer is retrievable immediately.
4. The suspended run resumes and takes one more model turn to produce the final reply
   to the guest.

The effect: every owner answer permanently improves the knowledge base, not just that
one conversation.

## 3. Summarization

Guest memory is a two-tier system: a durable per-guest preference summary, plus a
small, capped window of recent "folds."

- **Per-turn trimming**: recent messages are loaded fresh from Postgres each turn and
  trimmed to a token budget using a real tokenizer (`gpt-tokenizer`'s o200k_base
  encoder, the closest available approximation since no maintained tokenizer exists
  for the production model). Budget: 1600 tokens in, trimmed down to 800.
- **Folding**: whenever trimming drops messages out of that window, the dropped chunk
  (never the full history) gets summarized on its own and stored as a row in
  `guest_memory_folds`. Only one recent fold is kept per guest.
- **Distillation**: once a guest has more than one fold row, the oldest is distilled
  into that guest's durable `preferences_summary` via a separate LLM call, then
  deleted, so the fold table never grows unbounded while the preference summary keeps
  accumulating.
- **Injection**: the preference summary and the single most recent fold are combined
  into one synthetic message prepended to the conversation, sent with an `assistant`
  role rather than `system`, since the Vercel AI SDK warns against `system`-role
  entries appearing mid-array, a provider-shaped constraint that isn't obvious from
  the message-role names alone.
- **Off the critical path**: folding runs as its own Inngest step, scheduled after the
  WhatsApp reply has already been sent. The summarizer call measured 24 to 43 seconds
  in real traces, so it no longer adds any of that latency to the guest's reply.
- **URL redaction**: before anything is folded or shown to the model, URLs are
  replaced with a placeholder. A two-URL message alone measured 231 tokens with the
  real tokenizer; the model only needs to know a link was sent, not its bytes. Real
  links are untouched in storage, this only affects what the model sees.

Both the conversation summarizer and the preferences distiller are separate,
version-pinned prompts managed in Braintrust's Prompt Hub, so either can be iterated
and evaluated independently of the agent's main prompt.

## 4. Durable execution

Every side effect that matters (model calls, tool calls, sending the WhatsApp
reply, both suspend/resume flows) runs inside Inngest `step.run`/`step.waitForEvent`,
which gives replay-safe, memoized execution: if the process restarts or a step fails,
already-completed steps aren't repeated, and a turn that's suspended for hours (waiting
on an owner's answer or approval) picks back up exactly where it left off.

One internal rule that guards against a silent failure mode: three tools (`missing_info`, `send_booking_link`, `wants_human`) manage their
own Inngest steps internally, since they suspend/wait; they must never be called from
inside another `step.run`, because Inngest doesn't support nesting a step inside
another step's callback. That's enforced as an explicit convention in this codebase
rather than left as tribal knowledge.

## 5. Human-in-the-loop: `send_booking_link`

Sending a booking link is the one action gated behind explicit owner approval before
it happens. When the model calls `send_booking_link`:

1. The owner gets a Telegram message with inline Approve/Reject buttons.
2. The run suspends on `step.waitForEvent`, matched by correlation ID carried in the
   button's callback data (not parsed from free text, more reliable).
3. Approve → the link is built and returned to the model to send. Reject or timeout →
   the model receives a structured "not approved" result and responds accordingly,
   the tool's real logic never executes.

The gate is implemented as a small reusable primitive (`requestApprovalGate`), not
hand-rolled per tool: declared once as policy (which tools require approval) and
enforced centrally, so adding a second gated tool in the future is a one-line policy
change, not new suspend/resume plumbing.

The booking record itself is written only once payment is real, not when the link is
merely approved and sent, keeping approval and payment as two independent gates.

## 6. Sandboxed code execution (`run_code`)

The agent has an 8-step cap per turn. Some tasks (e.g. "find the next available date
across several candidate ranges") would burn most of that budget on repeated
`check_availability` calls. `run_code` lets the model write one short script that does
that work in a single step instead.

That script runs in a **Vercel Sandbox** (a real isolated microVM, not an in-process
`vm`/`vm2` sandbox) with a hard execution timeout and guaranteed teardown. Because the
sandbox is a genuinely separate machine, it can't reach back into the running Node
process, so the handful of tools it's allowed to use are deliberately re-implemented
for that context: availability checks hit the same public API the real tool uses,
pricing is passed in as a precomputed literal, and the current date is re-evaluated at
sandbox runtime. The exposed surface is an explicit allowlist, checked before
execution.

`send_booking_link` is intentionally excluded from that allowlist: a payment- and
approval-relevant action should never be reachable from model-generated code, only
from a normal, gated tool call. That's a boundary I treat as non-negotiable: sandboxing
solves "run untrusted code safely," not "let untrusted code take real-world actions."

## 7. Evaluation

Evaluation runs at two layers, both on Braintrust.

**Offline evals**, run against a golden dataset before merging:

- A **golden dataset** (29 hand-built cases) covering the agent's four key
  tool-selection decisions (`send_booking_link`, `get_pricing`, `missing_info`,
  `answer_property_question`), scored with a **Tool Call Match** scorer, run at
  3 trials per case since the model is non-deterministic.
- A **prompt-injection dataset** (10 cases) with adversarial guest messages, scored on
  both Tool Call Match and a **Security Invariant Held** scorer: an LLM judge that
  checks, per case, whether a specific stated security invariant held or was violated,
  binary pass/fail with no partial credit.
- A **CI gate** enforces independent thresholds (not averaged together) before code can
  merge to `develop`: ≥80% tool-call accuracy on the golden set, and ≥90% on both
  tool-call accuracy and security-invariant-held on the prompt-injection set. Scoped to
  changes under this app's path and to the `develop` branch only, to avoid burning real
  API spend on every push.

**Online scorers**, registered as real Braintrust scorer functions and run
server-side against every production conversation:

- **HITL Compliance**: pure code (no LLM), checks the approval trail on every
  `send_booking_link` call for bypasses, importing the same pattern the real tool uses
  as its source of truth so the check can't silently drift from the implementation.
- **Brand Alignment**: an LLM judge scoring tone/voice consistency.
- **Correct Tool Calling**: an LLM judge that imports the live tool definitions
  directly, so the rubric it judges against is always the real tool descriptions, not
  a hand-copied summary that goes stale.

Treating prompt-injection resistance as a CI-blocking eval, not an afterthought, and
keeping scorer logic wired to the real source of truth (tool definitions, URL
patterns) rather than a parallel hand-maintained copy, are the two choices here I'd
point to as deliberate rather than incidental.

## 8. Observability: OpenTelemetry + Axiom

The app wires two OpenTelemetry span processors onto one shared tracer provider:
Braintrust (filtered to AI/LLM-related spans, for trace-level debugging tied to evals
and prompt versions) and Axiom (unfiltered OTLP export of every span, including
framework-level HTTP spans, for two live dashboards: `GCA-app health` for error rate
and latency by pipeline stage, `GCA-business` for the guest-journey funnel). Both are
best-effort in development, a missing env var skips that processor rather than
crashing the app; in production, missing Axiom config fails the boot loudly instead
(see "Production vs. development" below), since booting with zero observability is
worse than not booting at all.

### Span strategy

A handful of small primitives in `src/lib/tracing.ts` cover every case in this app:

- **`withSpan`** — the default. Nests under whatever span is already active via
  OTel's own ambient context; starts a fresh root if nothing is active. Used for
  anything running synchronously inside an already-open trace (most DB calls,
  tool-internal work).
- **`startTraceRoot`** — deliberately starts a brand-new, unparented trace. Used at
  the very start of a real request (the webhook's own root span), and by handlers
  that genuinely can't join anything else (see next section).
- **`withTurnSpan` + `TraceAnchor`** — nests under an explicitly-passed
  `{traceId, spanId}` rather than ambient context, because Inngest steps don't
  preserve a live in-process span across a `step.run`/replay boundary. The anchor is
  threaded through the triggering event's own data, so every stage of a turn (webhook
  → model → tools → reply) nests correctly even after a replay.
- **`steppedSpan`** — the Inngest-specific glue, wraps `step.run` and `withTurnSpan`
  together so the two different jobs they do (replay-safe memoization, span creation)
  can't accidentally duplicate on replay.
- **`markSpanFailed`** — marks a span ERROR without throwing, for call sites that
  already catch a failure and downgrade it to a return value rather than propagate an
  exception. Most of this app's external calls (Twilio, the Telegram relay, Supabase
  writes) follow that shape, so a failed call is still visible in Axiom even when it
  doesn't blow up the guest's turn.

### Continuing a trace across a real pause

Two flows suspend a turn and wait on a human, potentially for hours: `missing_info`
(§2) and `send_booking_link` (§5). When the owner eventually replies on Telegram, that
reply lands as a brand-new HTTP request, in a different process, with no live span or
Inngest execution context to nest under. `withTurnSpan`'s anchor doesn't help here
either, it rides along in Inngest's own event data, and this later request never goes
through Inngest at all.

Left alone, every one of these replies would land as its own small, disconnected
trace, with no link back to the original conversation, the correlation ID isn't even
searchable on the original side, it exists purely as an Inngest `waitForEvent` key,
never stamped onto a span there.

The fix is a small DB table, keyed by correlation ID, storing the real
`{traceId, spanId}` of the original tool-call span at the moment the nudge goes out:
`missing_info_trace_anchors` for the KB-answer flow, `approval_gate_trace_anchors`
for booking approvals, two parallel tables rather than one shared one, so a schema
change to either can't affect the other. When the reply arrives, the route consumes
the anchor (reads and deletes the row, single-use); if found, the reply's work nests
via `withTurnSpan` directly under the original `gen_ai.tool.*` span, same trace as the
rest of the conversation; if not found (the write itself failed, or the row was
already consumed by a duplicate call), it falls back to `startTraceRoot`, a
disconnected trace, worse for debugging but never worse for the guest. Recording the
anchor is itself best-effort, and a guest's real reply must never be blocked on a
tracing nicety succeeding.

### Heartbeat

Real traffic on a single-property agent is low and sporadic. A naive "alert if zero
events land in N minutes" dead-man's-switch would false-alarm constantly on a
perfectly healthy system, simply because nobody happened to message in the last N
minutes, training you to ignore it.

Instead, `instrumentation.ts` emits a synthetic `instrumentation.heartbeat` span every
5 minutes, independent of any real guest or business activity, purely proving "this
process is alive and can still reach Axiom." An Axiom Threshold monitor watches for
that span specifically dropping below one occurrence over a 15-minute window (three
missed cycles of buffer), wired to an email notifier. That's the one piece of this
system that has to live outside the app's own code: if the observability pipeline
itself goes fully dark, nothing running through that same pipeline can report its own
silence, the monitor exists to be the thing still watching when everything else stops.

telegram-router (the separate app that owns all Telegram I/O) is wired up the same
way, minus the Braintrust processor, since it makes no LLM calls of its own.

### Production vs. development

Missing/invalid Axiom config warns and continues in development (a developer without
an Axiom token should still be able to run the app), but throws at boot in production,
failing the deploy loudly rather than running with zero observability. Braintrust's
config stays warn-only in every environment: it's already effectively enforced
elsewhere (prompt-loading throws on its own if Braintrust is unreachable), and losing
just the AI-trace layer on top of a working Axiom pipeline is far lower-stakes than
losing Axiom itself.

## 9. Database access model

Two Supabase clients exist (`src/lib/supabase.ts`): `createClient()` (anon key,
subject to RLS) and `createAdminClient()` (service role, bypasses RLS). Which one a
call site uses isn't a per-developer judgment call — it follows directly from each
table's RLS/grant state:

- `documents` has RLS enabled with one policy: unrestricted anon `SELECT`. It's the
  property knowledge base, meant to be publicly readable — `answer_property_question`
  reads it via the anon client for that reason. Anon has no write grant on it, so the
  two paths that write to it (`scripts/embed.ts`, and `missing_info`'s owner-reply
  handler) use the admin client — not a choice, the only way to write it.
- Every other table this app touches (`whatsapp_conversations`, `whatsapp_messages`,
  `guest_memory`, `guest_memory_folds`, `pending_owner_decisions`,
  `missing_info_trace_anchors`, `approval_gate_trace_anchors`) has RLS enabled with
  **zero** policies and an explicit `revoke all ... from anon, authenticated`. Anon has
  no access to these at all, by design — the admin client is the only way in, for
  reads and writes alike.

Why the wide grant to a single key instead of per-table RLS policies: this app is a
single-tenant backend, not a multi-tenant one. There's no per-guest Supabase Auth
session to hang a policy on — a "guest" is just a phone number carried through
server-side application state (`conversationId`/`phone`), never issued its own DB
credential. GCA's own backend is the sole first-party operator of this database, so
service role is the natural fit: one trusted process, full access to its own
operational tables, no anon-facing surface on any of them.

The tradeoff this implies: isolation between guests/conversations (making sure a
query for one `conversation_id` never touches another's rows) is enforced entirely at
the application layer — every query's own `.eq("conversation_id", ...)` /
`.eq("phone", ...)` filter — not backstopped by Postgres. Real per-conversation RLS
policies would require issuing a scoped identity per request (e.g. a session variable
set on each turn) and switching these call sites off service role, which is a real
architecture change, not a config tweak. Not currently planned; noted here so the
tradeoff is explicit rather than accidental.

## 10. Known limitations / in progress

- **`missing_info` no-reply timeout**: currently just logs rather than re-nudging the
  owner. Acceptable for a low-volume single-property agent, would need a retry/
  escalation policy at higher volume.
- **telegram-router's Axiom dataset**: instrumented and verified locally (§8), but the
  dataset it exports to doesn't exist yet in Axiom, and the app's own token can't
  create one, that's a one-time manual step, not a code gap.
- **No DB-level isolation backstop between guests/conversations**: see §9 — correctness
  depends on every query's own scoping filter, not enforced by RLS.
- **`missing_info` KB writes are unvalidated**: an owner's raw Telegram reply is
  embedded into the public `documents` table verbatim (`missing-info.ts`'s
  `handleMissingInfoReplyReceived`), with no content review before it becomes readable
  by anyone with the anon key. Fine for expected use (answering a guest's question);
  no safeguard against an owner accidentally including something not meant to be
  public.
