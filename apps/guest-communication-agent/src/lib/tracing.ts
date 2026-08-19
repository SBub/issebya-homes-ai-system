import { type Attributes, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import { createAdminClient } from "@/lib/supabase";

const tracer = trace.getTracer("guest-communication-agent");

// A real span's identity, threaded explicitly (as plain JSON) so later spans
// — possibly in a different process, or a different Inngest replay — can
// parent to it without ever holding the original Span object open. See
// startTraceRoot/withTurnSpan below.
export interface TraceAnchor {
  traceId: string;
  spanId: string;
}

// Stamps the real OTel trace id onto every span as a plain attribute.
// Braintrust doesn't expose the underlying OTel trace id as a searchable
// field anywhere in its UI — you can only ever see it after already opening
// a trace — but it does index arbitrary attributes under a searchable
// `metadata.*` namespace. Setting it here means pasting an Axiom trace id
// into Braintrust's search bar as `metadata."gca.trace_id"` actually finds
// the matching trace.
function stampTraceId(span: Span): void {
  span.setAttribute("gca.trace_id", span.spanContext().traceId);
}

// Records a marker event on whatever span is ambient in context, if any —
// used by every "best-effort, never throw" helper below (updateSpanIO,
// {record,consume}{MissingInfo,ApprovalGate}TraceAnchor) so a permanent,
// silent failure of one of these Braintrust/anchor niceties is at least
// visible on the trace, instead of only a console.error nobody's tailing.
// Deliberately an event, not markSpanFailed/an ERROR status — these helpers'
// own doc comments are explicit that they must never be allowed to make a
// guest's actual turn look like it failed just because a trace-linking
// nicety silently failed in the background. Same non-fatal-but-noteworthy
// pattern as run-turn.ts's modelTurn "gen_ai.retry" event.
// No-ops if there's no active span in context at the call site — that's a
// legitimate outcome (e.g. called from code with no ambient turn span), not
// something worth forcing a span into existence for.
function recordBestEffortFailure(helper: string, message: string): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent("tracing.best_effort_failed", {
      "tracing.helper": helper,
      "error.message": message,
    });
  }
}

// Starts a genuine trace root: an unparented real span, letting the OTel SDK
// generate both trace_id and span_id for real (unlike withTurnSpan below,
// which always parents to an already-known anchor). Call this exactly once
// per real turn — the webhook route's very first span (route.ts's POST) —
// then thread the returned `anchor` through everything downstream via
// withTurnSpan(anchor, ...), including across the webhook-request ->
// Inngest-function boundary (the triggering event payload carries `anchor`
// as plain JSON — see run-turn.ts's GuestTurnRequestedEventData).
//
// The anchor must be a real, emitted span id, not a synthetic/hashed
// placeholder — a fake, never-emitted parent id would make every span in a
// turn point at the same non-existent parent instead of at each other,
// leaving the trace flat in Braintrust and showing a "(missing)" root in
// Axiom's waterfall view. Inngest's guarantee that `event.data` replays
// identically is what keeps the anchor stable across replays.
export async function startTraceRoot<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<{ anchor: TraceAnchor; result: T }> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    stampTraceId(span);
    const { traceId, spanId } = span.spanContext();
    try {
      const result = await fn(span);
      return { anchor: { traceId, spanId }, result };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Runs `fn` as a new span parented to `anchor` (see startTraceRoot/
// TraceAnchor above) — every span sharing the same anchor.traceId lands in
// the same Braintrust trace, properly nested under whichever real span
// anchor.spanId refers to, across Inngest replays, without ever holding a
// live Span object across a step boundary. Callers MUST wrap every call to
// this in a step.run() (or only call it from code that only executes once)
// — see run-turn.ts's SELF_STEPPED_TOOLS comment for why calling this from
// un-stepped code would duplicate-emit spans on Inngest replay.
//
// Deliberately does NOT set an OK status when `fn` resolves without
// throwing — an unset status already reads as "not an error" in every OTel
// backend, and explicitly setting OK here would clobber markSpanFailed's
// ERROR status on "soft-fail" call sites (e.g. send-whatsapp-reply: `fn`
// catches sendWhatsAppMessage's failure, calls markSpanFailed, then returns
// normally without throwing — an explicit OK on success would overwrite
// that ERROR status right after, silently undercounting failures in any
// error-rate query filtered on status). Only ever set ERROR, never OK —
// matches OTel's own guidance that an explicit OK is for overriding an
// already-set error status, not a default to apply everywhere.
export async function withTurnSpan<T>(
  anchor: TraceAnchor,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parentContext = trace.setSpanContext(context.active(), {
    traceId: anchor.traceId,
    spanId: anchor.spanId,
    traceFlags: 1, // sampled
    isRemote: true,
  });
  return context.with(parentContext, () =>
    tracer.startActiveSpan(name, { attributes }, async (span) => {
      stampTraceId(span);
      try {
        return await fn(span);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    }),
  );
}

// Braintrust reads specific attribute namespaces to populate its UI — set
// the wrong one and the data is still in the trace (visible in Axiom/OTel)
// but invisible in Braintrust's own views. Three distinct facts, easy to
// conflate because they share the "braintrust." prefix but govern different
// parts of the UI — this comment is the one canonical explanation of all
// three; call sites that set these attributes should point back here rather
// than re-explain:
//   - `braintrust.input`/`braintrust.output` map to a span's top-level
//     Input/Output fields (Traces list + per-span view). `gen_ai.*`
//     attributes (gen_ai.input.messages, etc.) only ever land in the span's
//     Metadata tab — @braintrust/otel's BraintrustSpanProcessor does no
//     gen_ai.*-to-input/output conversion of its own (see
//     node_modules/@braintrust/otel/dist/index.js). Any call site that wants
//     its gen_ai.* content to actually show up as Input/Output has to
//     duplicate it under braintrust.input/braintrust.output too — see
//     run-turn.ts's modelTurn for a real example.
//   - `braintrust.tags` aggregates from ANY span in a trace up to the whole
//     trace level, making the whole trace filterable by a tag set on one
//     span deep in the tree — see run-turn.ts's firedTags for how this app
//     uses that. String arrays are a native OTel attribute value — no
//     JSON.stringify needed.
//   - A `braintrust.*`-prefixed attribute is also what gets a span past
//     export filtering at all, unrelated to what Braintrust's UI does with
//     the value once it arrives. `@braintrust/otel`'s AISpanProcessor (wired
//     via `filterAISpans: true` in instrumentation.ts) drops any span whose
//     name AND every non-system attribute key fail to start with one of
//     `gen_ai.`/`braintrust.`/`llm.`/`ai.`/`traceloop.` (confirmed directly
//     from `node_modules/@braintrust/otel/dist/index.js`'s `FILTER_PREFIXES`/
//     `isAISpan`) — a span named e.g. `owner_nudge.sendBookingLink.decision`
//     with only `gca.*` attributes never reaches Braintrust at all, no
//     matter how meaningful its data is. See approval-gate.ts's
//     `requestApprovalGate` and run-turn.ts's `dispatchWantsHuman`/
//     `runMissingInfo` for real call sites that set a `braintrust.tags`/
//     `braintrust.approval_decision` attribute only to clear this filter, not
//     to populate Input/Output/tags.
// All are plain span.setAttribute(...) calls made at each call site, not
// something withTurnSpan/withSpan set automatically — there's no single
// choke point to hang this logic on, which is exactly why the explanation
// tends to drift when repeated instead of referenced.

// Collapses the two-call nesting that shows up at every real call site in
// this app — `step.run(stepId, () => withTurnSpan(anchor, name, attrs, fn))`
// — into one call, so the actual business logic (`fn`) isn't buried two
// closures deep behind boilerplate that's identical everywhere it appears.
// The two calls being combined do genuinely different jobs and both still
// happen, in the same order, with the same semantics:
//   - step.run (Inngest's GetStepTools, from `inngest`'s own types) is the
//     durability/replay-memoization primitive — Inngest persists `fn`'s
//     result under `stepId` and, on any later replay of this function (e.g.
//     after a step.waitForEvent elsewhere resumes), returns the memoized
//     result instead of re-running `fn`. That's what makes it safe to send a
//     real Telegram/WhatsApp message or write to Postgres inside `fn`.
//   - withTurnSpan (above) is this app's own OTel span helper — it opens a
//     span parented to `traceAnchor`, runs `fn`, and closes the span,
//     recording an exception/ERROR status if `fn` throws.
// step.run must wrap withTurnSpan, not the other way around, so the span
// itself is also only ever created once (inside the memoized callback), not
// re-emitted on every replay.
export async function steppedSpan<T>(
  step: GetStepTools<typeof inngest>,
  stepId: string,
  traceAnchor: TraceAnchor,
  spanName: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  // Cast needed: step.run()'s return type is run through Inngest's Jsonify
  // transform (step results are actually persisted as JSON and rehydrated on
  // replay), which narrows types like FilePart's `data: URL | DataContent`
  // down to their JSON-safe equivalents. Every call site returns a plain
  // JSON-safe value (a string, a DB row, a fetch result, etc.), so the
  // narrowing is a false positive here.
  return step.run(stepId, () => withTurnSpan(traceAnchor, spanName, attributes, fn)) as Promise<T>;
}

// Generic, non-deterministic child span — same lifecycle (recordException +
// ERROR status on throw, always end()) as withTurnSpan's inner block, minus
// the deterministic correlationId-derived parent wiring. Nests automatically
// under whatever span is active via context.active() (e.g. a webhook.* stage
// span, a gen_ai.tool.* span, a run-turn.ts step span) — no explicit parent
// needed. If nothing is active, it starts a fresh root trace, which is
// correct for callers with no ambient turn context (e.g. a standalone
// probe outside any guest turn).
//
// Same replay-safety caveat as withTurnSpan: only call this from code that
// runs at most once per real invocation — i.e. from inside an already-
// established step.run() callback, or from plain (non-Inngest-replayed) HTTP
// handler code. Calling it from un-stepped Inngest function-body code that
// re-executes on replay would duplicate-emit spans.
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    stampTraceId(span);
    try {
      // Same reasoning as withTurnSpan: no explicit OK on success, so a
      // markSpanFailed call inside `fn` (soft-fail, doesn't throw) isn't
      // clobbered back to OK right after — see withTurnSpan's own comment.
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Marks a span ERROR without throwing — for call sites that already catch a
// failure and downgrade it to a plain return value (e.g. sendWhatsAppMessage's
// `{ ok: false, error }`, requestOwnerNudge's `false`) rather than propagate
// an exception. Using this instead of a throw keeps existing control flow and
// return values exactly as they are; it only makes the failure visible on the
// trace, where before it was invisible even to a wrapping withSpan/
// withTurnSpan (their catch blocks only fire on a real throw).
export function markSpanFailed(span: Span, message: string): void {
  span.recordException(new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

// issebya's Braintrust org is EU-data-plane — same gotcha as everywhere else
// in this app (instrumentation.ts, scripts/migrate-prompts-to-braintrust.ts).
const BRAINTRUST_API_BASE = process.env.BRAINTRUST_API_URL ?? "https://api-eu.braintrust.dev";

// Retroactively patches a specific span's input/output fields after the
// span has already closed, via Braintrust's log-insert-with-merge REST API
// (POST /v1/project_logs/{project_id}/insert, { _is_merge: true }, keyed by
// the row's `id` — Braintrust maps a span's OTel-generated span id directly
// to that row id). `_is_merge: true` deep-merges just the given fields into
// the existing row, leaving its real metadata/metrics/span_attributes/trace
// linkage untouched.
//
// Exists for run-turn.ts's "braintrust.guest_turn" root marker span: its
// input (the guest's incoming message) is known when the span is created,
// but its output (the turn's final reply) isn't known until well after the
// span has already been created and closed inside its own step.run — so
// there's no live Span object left to call span.setAttribute on by the time
// the reply exists. This patches the row directly instead.
//
// Best-effort and non-fatal, matching this app's existing convention for
// optional enrichment calls (e.g. TELEGRAM_ROUTER_API_URL unset just
// degrades a feature rather than crashing): no-ops if
// BRAINTRUST_API_KEY/BRAINTRUST_PROJECT_ID aren't set, and never throws — a
// trace-enrichment call failing must never break a guest's actual reply.
export async function updateSpanIO(
  spanId: string,
  fields: { input?: unknown; output?: unknown; tags?: string[] },
): Promise<void> {
  const apiKey = process.env.BRAINTRUST_API_KEY;
  const projectId = process.env.BRAINTRUST_PROJECT_ID;
  if (!apiKey || !projectId) {
    return;
  }

  // tags is omitted entirely (rather than sent as []) when empty, so a merge
  // patch with no tags to add never clobbers tags a span already has —
  // matching the "tags aggregate at the trace level" mechanism this exists
  // for (see run-turn.ts's firedTags comment).
  const { tags, ...rest } = fields;
  const patch = tags && tags.length > 0 ? { ...rest, tags } : rest;

  try {
    const response = await fetch(`${BRAINTRUST_API_BASE}/v1/project_logs/${projectId}/insert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [{ id: spanId, _is_merge: true, ...patch }],
      }),
    });
    if (!response.ok) {
      const message = `${response.status} ${await response.text()}`;
      console.error(`[tracing] updateSpanIO failed for span "${spanId}": ${message}`);
      recordBestEffortFailure("updateSpanIO", message);
    }
  } catch (err) {
    console.error(`[tracing] updateSpanIO threw for span "${spanId}":`, err);
    recordBestEffortFailure("updateSpanIO", (err as Error).message);
  }
}

// The DB table recordMissingInfoTraceAnchor/consumeMissingInfoTraceAnchor
// below read/write — see supabase/migrations's
// create_missing_info_trace_anchors.sql for the schema and the full
// tradeoff writeup (self-cleans on the happy path, can leak an orphaned row
// on a timed-out/never-answered missing_info call).
const MISSING_INFO_TRACE_ANCHOR_TABLE = "missing_info_trace_anchors";

// Cross-HTTP-request trace anchor handoff, for missing_info's owner-reply
// flow specifically. The Inngest step boundary threads a TraceAnchor through
// event.data (see startTraceRoot's own comment) because Inngest guarantees
// event.data replays identically — there's no equivalent guarantee, or even
// a shared payload at all, across an HTTP-request boundary to a completely
// separate route (the owner-nudges answer route, triggered by
// apps/telegram-router's own webhook, sometimes hours later, possibly a
// different server instance). This small DB-backed lookup fills that gap
// instead: run-turn.ts's runMissingInfo writes the tool-call span's anchor
// here right after creating it, keyed by this turn's correlationId; the
// answer route reads (and deletes) it once the owner's reply arrives.
//
// Best-effort like updateSpanIO: a failed write here only degrades tracing
// (the embedding step's span falls back to its own disconnected trace root
// instead of nesting under the real gen_ai.tool.missing_info span) — never
// the actual KB write or guest-facing behavior.
export async function recordMissingInfoTraceAnchor(
  correlationId: string,
  anchor: TraceAnchor,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from(MISSING_INFO_TRACE_ANCHOR_TABLE).insert({
      correlation_id: correlationId,
      trace_id: anchor.traceId,
      span_id: anchor.spanId,
    });
    if (error) {
      console.error(
        `[tracing] recordMissingInfoTraceAnchor failed for correlationId "${correlationId}": ${error.message}`,
      );
      recordBestEffortFailure("recordMissingInfoTraceAnchor", error.message);
    }
  } catch (err) {
    console.error(
      `[tracing] recordMissingInfoTraceAnchor threw for correlationId "${correlationId}":`,
      err,
    );
    recordBestEffortFailure("recordMissingInfoTraceAnchor", (err as Error).message);
  }
}

// Reads AND deletes in one call — the row's only reader is the one real
// owner reply for this correlationId, so consuming it here is what makes the
// table self-clean on the happy path (see the migration's own comment for
// the orphaned-row case this doesn't cover). Returns null (not a throw) on
// any failure or a genuine miss — same best-effort posture as
// recordMissingInfoTraceAnchor above and updateSpanIO.
export async function consumeMissingInfoTraceAnchor(
  correlationId: string,
): Promise<TraceAnchor | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from(MISSING_INFO_TRACE_ANCHOR_TABLE)
      .delete()
      .eq("correlation_id", correlationId)
      .select("trace_id, span_id")
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return { traceId: data.trace_id as string, spanId: data.span_id as string };
  } catch (err) {
    console.error(
      `[tracing] consumeMissingInfoTraceAnchor threw for correlationId "${correlationId}":`,
      err,
    );
    recordBestEffortFailure("consumeMissingInfoTraceAnchor", (err as Error).message);
    return null;
  }
}

// The DB table recordApprovalGateTraceAnchor/consumeApprovalGateTraceAnchor
// below read/write — see supabase/migrations's
// create_approval_gate_trace_anchors.sql for the schema and the full
// tradeoff writeup (self-cleans on the happy path, can leak an orphaned row
// on a timed-out/never-decided gated call). A separate table from
// MISSING_INFO_TRACE_ANCHOR_TABLE above, on purpose — this pair is generic
// over every approval-gate.ts's requestApprovalGate caller (any
// run-turn.ts APPROVAL_GATES entry, send_booking_link today, any future tool
// tomorrow), not just one tool, and keeping it a fully separate mechanism
// means it can't ever disturb the already-verified-working missing_info
// path above.
const APPROVAL_GATE_TRACE_ANCHOR_TABLE = "approval_gate_trace_anchors";

// Cross-HTTP-request trace anchor handoff, for approval-gate.ts's
// requestApprovalGate specifically (generic over every APPROVAL_GATES-gated
// tool, not hardcoded to one). Same gap this fills as
// recordMissingInfoTraceAnchor above: the HTTP-request boundary to the
// owner-nudges approve route (triggered by apps/telegram-router's own
// webhook, possibly hours later, possibly a different server instance) has
// no shared payload/Inngest event.data to carry a TraceAnchor through. This
// small DB-backed lookup fills that gap instead: requestApprovalGate writes
// the gated tool's real gen_ai.tool.<toolName> span's anchor here right when
// it's called (that anchor arrives as this function's own `anchor` param —
// requestApprovalGate never touches a live Span object, only the
// already-extracted {traceId, spanId} its caller, run-turn.ts's
// dispatchGatedToolCall, passes in as `traceAnchor`), keyed by this turn's
// correlationId; the approve route reads (and deletes) it once the owner's
// decision arrives.
//
// Best-effort like recordMissingInfoTraceAnchor: a failed write here only
// degrades tracing (the approve route's decision span falls back to its own
// disconnected trace root instead of nesting under the real
// gen_ai.tool.<toolName> span) — never the actual approval/rejection
// handling or guest-facing behavior.
export async function recordApprovalGateTraceAnchor(
  correlationId: string,
  anchor: TraceAnchor,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from(APPROVAL_GATE_TRACE_ANCHOR_TABLE).insert({
      correlation_id: correlationId,
      trace_id: anchor.traceId,
      span_id: anchor.spanId,
    });
    if (error) {
      console.error(
        `[tracing] recordApprovalGateTraceAnchor failed for correlationId "${correlationId}": ${error.message}`,
      );
      recordBestEffortFailure("recordApprovalGateTraceAnchor", error.message);
    }
  } catch (err) {
    console.error(
      `[tracing] recordApprovalGateTraceAnchor threw for correlationId "${correlationId}":`,
      err,
    );
    recordBestEffortFailure("recordApprovalGateTraceAnchor", (err as Error).message);
  }
}

// Reads AND deletes in one call — same self-cleaning-on-the-happy-path
// reasoning as consumeMissingInfoTraceAnchor above. Returns null (not a
// throw) on any failure or a genuine miss — same best-effort posture as
// recordApprovalGateTraceAnchor above.
export async function consumeApprovalGateTraceAnchor(
  correlationId: string,
): Promise<TraceAnchor | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from(APPROVAL_GATE_TRACE_ANCHOR_TABLE)
      .delete()
      .eq("correlation_id", correlationId)
      .select("trace_id, span_id")
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return { traceId: data.trace_id as string, spanId: data.span_id as string };
  } catch (err) {
    console.error(
      `[tracing] consumeApprovalGateTraceAnchor threw for correlationId "${correlationId}":`,
      err,
    );
    recordBestEffortFailure("consumeApprovalGateTraceAnchor", (err as Error).message);
    return null;
  }
}
