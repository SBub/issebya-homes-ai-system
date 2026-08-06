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
