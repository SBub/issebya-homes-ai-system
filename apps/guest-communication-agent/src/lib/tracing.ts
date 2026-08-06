import crypto from "node:crypto";
import { type Attributes, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("guest-communication-agent");

// Derives a stable trace id and "root" parent span id purely from
// correlationId (already threaded through this whole codebase — see
// RunAgentTurnConfig.correlationId in run-turn.ts), via a deterministic
// hash. No randomness, no memoization needed for the ids themselves —
// they're identical on every replay by construction.
//
// This exists because Inngest's execution model re-runs a function's body
// OUTSIDE any step.run() callback on every replay (e.g. after
// missing_info's step.waitForEvent suspends for up to 24h and later
// resumes) — only a step.run()'s *return value* is memoized. That means no
// JS state (including a live OTel Span object) can survive across step
// boundaries, so this turn's trace can't be built by holding one root span
// open for its duration. Deriving the ids from correlationId instead means
// every span emitted for the same correlationId lands in the same
// Braintrust trace, across Inngest replays, without ever holding a live
// Span object across a step boundary.
export function turnTraceContext(correlationId: string): { traceId: string; rootSpanId: string } {
  const hash = crypto.createHash("sha256").update(correlationId).digest("hex");
  return { traceId: hash.slice(0, 32), rootSpanId: hash.slice(32, 48) };
}

// Runs `fn` as a new span that's a child of this turn's deterministic root
// span (see turnTraceContext) — every span emitted for the same
// correlationId lands in the same Braintrust trace, across Inngest replays,
// without ever holding a live Span object across a step boundary. Callers
// MUST wrap every call to this in a step.run() (or only call it from code
// that only executes once) — see run-turn.ts's SELF_STEPPED_TOOLS comment
// for why calling this from un-stepped code would duplicate-emit spans on
// Inngest replay.
export async function withTurnSpan<T>(
  correlationId: string,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const { traceId, rootSpanId } = turnTraceContext(correlationId);
  const parentContext = trace.setSpanContext(context.active(), {
    traceId,
    spanId: rootSpanId,
    traceFlags: 1, // sampled
    isRemote: true,
  });
  return context.with(parentContext, () =>
    tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
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
