import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("telegram-router");

// Unlike guest-communication-agent's tracing.ts, this app has no Inngest
// steps and no cross-process replay to guard against — every request is
// handled synchronously, start to finish, in one process. That removes the
// entire reason GCA needs startTraceRoot/withTurnSpan/steppedSpan's explicit
// TraceAnchor threading: OTel's own ambient context (context.active(), set
// by tracer.startActiveSpan) is enough for a child span to nest under
// whichever span is already open, and a fresh root starts automatically when
// nothing is. One helper covers both cases.
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
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
// failure and downgrade it to a `{ ok: false, error }` return value (e.g.
// every telegram.ts send helper, gca.ts's relay calls) rather than propagate
// an exception. Same rationale as GCA's tracing.ts markSpanFailed: makes the
// failure visible on the trace without changing existing control flow.
//
// Accepts either the real caught value from a `catch (err)` block or a plain
// semantic string — widened to `unknown` so call sites that already have a
// real Error in scope can hand it straight through instead of pre-extracting
// `.message` and losing its real stack trace. An already-Error value is
// recorded as-is (real stack preserved); anything else (a plain string, or
// any other non-Error value) still gets wrapped in a synthetic `new
// Error(...)` exactly as before — there's no real stack to preserve for those.
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
