import { type Attributes, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { GetStepTools } from "inngest";
import type { inngest } from "@/lib/inngest";

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

// Starts a genuine trace root: an unparented real span, letting the OTel SDK
// generate both trace_id and span_id for real (unlike withTurnSpan below,
// which always parents to an already-known anchor). Call this exactly once
// per real turn — the webhook route's very first span (route.ts's POST) —
// then thread the returned `anchor` through everything downstream via
// withTurnSpan(anchor, ...), including across the webhook-request ->
// Inngest-function boundary (the triggering event payload carries `anchor`
// as plain JSON — see run-turn.ts's GuestTurnRequestedEventData).
//
// This replaced an earlier design (a `turnTraceContext(correlationId)` hash
// used as a synthetic, never-actually-emitted parent id) that made every
// turn's trace look flat in Braintrust — nothing ever nested under
// "braintrust.guest_turn", since every span pointed at the same fake parent
// instead of at each other — and showed a "(missing)" root in Axiom's
// waterfall view, since no span with that id was ever exported for it to
// find. Threading a real anchor instead fixes both: every span in a turn now
// genuinely descends from this one real root, and Inngest's own guarantee
// that `event.data` replays identically is what makes the anchor stable
// across replays — no hashing needed for that anymore.
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
// backend, and explicitly setting OK here used to clobber markSpanFailed's
// ERROR status on "soft-fail" call sites (e.g. send-whatsapp-reply: `fn`
// catches sendWhatsAppMessage's failure, calls markSpanFailed, then returns
// normally without throwing — this function's own success path was
// overwriting that ERROR back to OK immediately after). Confirmed live via a
// real Axiom trace: a genuine Twilio delivery failure showed the exception
// in the span's events but status.code "OK", which would silently undercount
// in any error-rate query filtering on status. Only ever set ERROR now,
// never OK — matches OTel's own guidance that an explicit OK is for
// overriding an already-set error status, not a default to apply everywhere.
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
  // narrowing is a false positive here — same reasoning each call site used
  // to spell out individually with its own `as X` cast before this helper
  // existed.
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
      console.error(
        `[tracing] updateSpanIO failed for span "${spanId}": ${response.status} ${await response.text()}`,
      );
    }
  } catch (err) {
    console.error(`[tracing] updateSpanIO threw for span "${spanId}":`, err);
  }
}
