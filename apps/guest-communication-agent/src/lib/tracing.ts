import { type Attributes, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";
import { createAdminClient } from "@/lib/supabase";

const tracer = trace.getTracer("guest-communication-agent");

// A real span's identity, threaded as plain JSON (not a live Span object) so
// a later span — possibly a different process, possibly a different Inngest
// replay — can still parent to it. No live Span object survives an Inngest
// step boundary, which is why every helper below takes/returns a TraceAnchor
// or a span id instead of a Span.
export interface TraceAnchor {
  traceId: string;
  spanId: string;
}

// Braintrust doesn't expose the OTel trace id anywhere in its UI directly,
// but does index attributes under a searchable `metadata.*` namespace — this
// makes an Axiom trace id pasted into Braintrust's search bar
// (metadata."gca.trace_id") actually find the matching trace.
function stampTraceId(span: Span): void {
  span.setAttribute("gca.trace_id", span.spanContext().traceId);
}

// Best-effort helpers below (updateSpanIO, the *TraceAnchor functions) must
// never fail a guest's turn just because a tracing nicety broke — this
// records that failure as an event (not markSpanFailed/ERROR) on whatever
// span is ambient, so it's at least visible in the trace instead of only a
// console.error. No-ops with no ambient span; that's a legitimate case, not
// worth forcing a span into existence for.
function recordBestEffortFailure(helper: string, message: string): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent("tracing.best_effort_failed", {
      "tracing.helper": helper,
      "error.message": message,
    });
  }
}

// Starts a genuine, unparented trace root — the OTel SDK generates a real
// trace_id/span_id (unlike withTurnSpan below, which always parents to an
// already-known anchor). Call once per turn (the webhook route's first
// span); thread the returned `anchor` downstream via withTurnSpan, including
// across the webhook -> Inngest boundary via the event payload (see
// run-guest-turn.ts's GuestTurnRequestedEventData). Must be a real emitted span
// id, not a synthetic one — a fake parent leaves every span in the turn
// pointing at a non-existent parent instead of each other.
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

// LANDMINE: only ever call this from inside an already-established
// step.run() callback (or other code that runs at most once per real
// invocation) — never from un-stepped Inngest function-body code. Un-stepped
// code re-executes on every Inngest replay, and this function always emits a
// real, new OTel span, so calling it un-stepped would duplicate-emit spans
// on replay.
//
// Runs `fn` as a new span parented to `anchor`, so every span sharing
// anchor.traceId lands in the same Braintrust trace, properly nested, across
// replays, with no live Span object held across a step boundary.
//
// Deliberately never sets an explicit OK status on success — only ERROR, on
// throw. An explicit OK would clobber markSpanFailed's ERROR status on a
// soft-fail call site that catches its own error and returns normally
// (e.g. run-guest-turn.ts's send-whatsapp-reply) — an unset status already reads
// as "not an error" everywhere OTel is consumed.
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

// LANDMINE (canonical explanation — reference this comment, don't re-derive
// it): Braintrust reads specific attribute namespaces to populate its UI.
// Set the wrong one and the data is still in the trace (visible in
// Axiom/OTel) but invisible in Braintrust's own views. All three below are
// plain span.setAttribute(...) calls made at each call site — nothing here
// sets them automatically.
//   - `braintrust.input`/`braintrust.output` map to a span's top-level
//     Input/Output fields. `gen_ai.*` attributes only ever land in the
//     Metadata tab — a call site that wants gen_ai.* content to show as
//     Input/Output must duplicate it under braintrust.input/output too.
//   - `braintrust.tags` aggregates from any span up to the whole trace,
//     making the trace filterable by a tag set deep in the tree.
//   - A `braintrust.*`-prefixed attribute (or a span name starting with
//     `gen_ai.`/`llm.`/`ai.`/`traceloop.`) is also what gets a span past
//     `@braintrust/otel`'s export filter at all — a span whose name and every
//     attribute key fail all five prefixes never reaches Braintrust,
//     regardless of how meaningful its data is.

// Collapses `step.run(stepId, () => withTurnSpan(anchor, name, attrs, fn))`
// into one call. step.run (Inngest's replay-memoization primitive — persists
// `fn`'s result under `stepId`, returns the memoized result on any later
// replay instead of re-running `fn`) must wrap withTurnSpan, not the other
// way, so the span itself is also only created once, not re-emitted on
// replay.
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

// Same lifecycle/replay-safety caveat as withTurnSpan above, minus explicit
// parent wiring — nests under whatever span is active via context.active(),
// or starts a fresh root if nothing is active (correct for callers with no
// ambient turn context).
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

// Marks a span ERROR without throwing — for call sites that catch a failure
// and downgrade it to a plain return value instead of propagating (a
// wrapping withSpan/withTurnSpan's own catch only fires on a real throw, so
// without this the failure would be invisible on the trace). Accepts a real
// Error (recorded with its real stack) or any other value (wrapped in a
// synthetic Error).
export function markSpanFailed(span: Span, messageOrError: unknown): void {
  if (messageOrError instanceof Error) {
    span.recordException(messageOrError);
    span.setStatus({ code: SpanStatusCode.ERROR, message: messageOrError.message });
    return;
  }
  const message = String(messageOrError);
  span.recordException(new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

// issebya's Braintrust org is EU-data-plane — same gotcha as everywhere else
// in this app (instrumentation.ts, scripts/migrate-prompts-to-braintrust.ts).
const BRAINTRUST_API_BASE = process.env.BRAINTRUST_API_URL ?? "https://api-eu.braintrust.dev";

// LANDMINE: retroactively patches a span's input/output after it has
// already closed (no live Span object survives an Inngest step boundary),
// via Braintrust's log-insert-with-merge REST API — `_is_merge: true` keyed
// by the row's `id` (Braintrust maps a span's OTel span id directly to that
// row id), deep-merging just the given fields.
//
// Races the span's own OTel export: both are independent writes to the same
// row, and whichever lands last wins — if the export lands after this
// patch, it silently resets input/output back to null. Callers MUST call
// flushTracing() (src/instrumentation.ts) right after their span's creation
// resolves, before anything else that could race ahead of it, or the patch
// can be silently lost.
//
// Best-effort and non-fatal: no-ops without BRAINTRUST_API_KEY/
// BRAINTRUST_PROJECT_ID, never throws — a trace-enrichment failure must
// never break a guest's actual reply.
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
  // for (see run-agent-turn.ts's firedTags comment).
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

// Schema: supabase/migrations's create_missing_info_trace_anchors.sql
// (self-cleans on the happy path, can leak an orphaned row if missing_info
// times out unanswered).
const MISSING_INFO_TRACE_ANCHOR_TABLE = "missing_info_trace_anchors";

// LANDMINE (canonical explanation for this table and
// APPROVAL_GATE_TRACE_ANCHOR_TABLE below): fills a gap TraceAnchor-via-
// event.data doesn't cover. Inngest guarantees event.data replays
// identically, which is why startTraceRoot's anchor can travel through it —
// but there's no equivalent guarantee, or even a shared payload, across an
// HTTP-request boundary to a separate route (here: the owner-nudges answer
// route, triggered by telegram-router's webhook, possibly hours later, on a
// possibly different server instance). This DB-backed lookup fills that
// gap: the writer stores its own GATE span's anchor here right after
// creating it, keyed by correlationId; the separate route reads (and
// deletes) it once the owner's reply/decision arrives. Best-effort like
// updateSpanIO — a failed write only degrades tracing (the other route's
// span falls back to its own disconnected trace root), never the real
// KB write, approval handling, or guest-facing behavior.
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

// Reads and deletes in one call — makes the table self-clean on the happy
// path. Returns null (not a throw) on any failure or a genuine miss.
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

// Schema: supabase/migrations's create_approval_gate_trace_anchors.sql. A
// separate table from MISSING_INFO_TRACE_ANCHOR_TABLE on purpose — generic
// over every requestApprovalGate caller (send_booking_link today, any future
// gated tool), not just missing_info.
const APPROVAL_GATE_TRACE_ANCHOR_TABLE = "approval_gate_trace_anchors";

// Same landmine/mechanism as recordMissingInfoTraceAnchor above, for
// approval-gate.ts's requestApprovalGate — fills the same HTTP-boundary gap
// for the owner-nudges approve route instead of the answer route.
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

// Same reads-and-deletes self-cleaning as consumeMissingInfoTraceAnchor above.
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
