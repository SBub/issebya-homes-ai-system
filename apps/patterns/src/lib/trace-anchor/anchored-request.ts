import type { Span, TraceAnchor, Tracer } from "@/lib/harness/span-exporter";
import type { DurableFunction, DurableRun, StepTools } from "@/lib/harness/step-runner";

/**
 * The request behind the `trace-anchor-across-steps` demo, on the harness
 * step runner and tracer. The route that receives a request opens the root
 * span and puts its anchor, `{ traceId, spanId }`, in the trigger event as
 * plain data. Every step opens its own child span under that anchor, inside
 * the step, so a replay neither re-emits the span nor loses the parent.
 * The gate step also records its own span's anchor in a table keyed by the
 * request id, and the resume route, a separate request hours later, consumes
 * that row once to nest the decision under the gate span.
 *
 * The wrong variants exist so the demo can show the failure:
 * - `context: "ambient"`: the function body opens the root span itself and
 *   every step nests under whatever span is active. A replay runs the body
 *   again, opens a second root, and the steps after the pause nest under
 *   that one: the trace splits in two.
 * - `rows: "reusable"`: the anchor row is read, not consumed, so a duplicate
 *   decision nests a second decision under a finished gate and the row never
 *   goes away.
 */

export const DECISION_EVENT = "request.decided";

export type AnchorsTable = {
  record(requestId: string, anchor: TraceAnchor): void;
  /** Reads and deletes in one call, so the table cleans itself on the happy path. */
  consume(requestId: string): TraceAnchor | null;
  /** The wrong variant: reads and keeps the row. */
  peek(requestId: string): TraceAnchor | null;
  rows(): Array<{ requestId: string; anchor: TraceAnchor }>;
};

export function createAnchorsTable(): AnchorsTable {
  const rows = new Map<string, TraceAnchor>();
  return {
    record(requestId, anchor) {
      rows.set(requestId, anchor);
    },
    consume(requestId) {
      const anchor = rows.get(requestId) ?? null;
      rows.delete(requestId);
      return anchor;
    },
    peek(requestId) {
      return rows.get(requestId) ?? null;
    },
    rows: () => [...rows].map(([requestId, anchor]) => ({ requestId, anchor })),
  };
}

/** `step.run` around a span under the anchor: the span is created once, never on a replay. */
export function steppedSpan<T>(
  step: StepTools,
  tracer: Tracer,
  id: string,
  anchor: TraceAnchor,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  return step.run(id, () => tracer.withSpan(id, { parent: anchor }, fn));
}

export type RequestResult = { approved: boolean; url: string | null };

export type RequestOptions = {
  tracer: Tracer;
  anchors: AnchorsTable;
  notify: (text: string) => void;
  timeout: number;
  context?: "anchor" | "ambient";
};

export function createRequestFunction(options: RequestOptions): DurableFunction<RequestResult> {
  const { tracer, anchors, notify, timeout, context = "anchor" } = options;

  const body = async (step: StepTools, requestId: string, anchor: TraceAnchor | undefined) => {
    // `anchor` undefined is the ambient variant: each span nests under whatever is active.
    const parent = anchor === undefined ? {} : { parent: anchor };

    await step.run("prepare", () =>
      tracer.withSpan("prepare", parent, (span) => {
        span.setAttribute("request.id", requestId);
        return true;
      }),
    );

    await step.run("notify-approver", () =>
      tracer.withSpan("request-approval", parent, (span) => {
        // The resume route gets only the request id, so the gate's anchor waits for it in a row.
        anchors.record(requestId, span.anchor);
        notify(`Approve request ${requestId}?`);
        return true;
      }),
    );

    const decision = await step.waitForEvent("wait-for-decision", {
      event: DECISION_EVENT,
      match: "data.requestId",
      timeout,
    });
    const approved = decision !== null && decision.data.approved === true;

    const url = await step.run("send-link", () =>
      tracer.withSpan("send-link", parent, () => (approved ? `/requests/${requestId}/link` : null)),
    );
    return { approved, url };
  };

  return async ({ event, step }) => {
    const requestId = String(event.data.requestId);
    if (context === "ambient") {
      // Plain function code opens the root: a replay opens another one.
      return tracer.withSpan("request", {}, () => body(step, requestId, undefined));
    }
    const anchor = event.data.traceAnchor as TraceAnchor;
    return body(step, requestId, anchor);
  };
}

export type ResumeOptions = {
  tracer: Tracer;
  anchors: AnchorsTable;
  run: DurableRun<RequestResult>;
  requestId: string;
  approved: boolean;
  rows?: "single-use" | "reusable";
};

/**
 * The resume route: records the decision as a span under the gate span when
 * its anchor row is there, else as its own root tagged with the request id,
 * then sends the event. The send happens after the span so the replay it
 * causes runs with no ambient span, as it does in a real runner, where the
 * replay is another process.
 */
export async function resumeRequest(
  options: ResumeOptions,
): Promise<{ nested: boolean; resumed: boolean }> {
  const { tracer, anchors, run, requestId, approved, rows = "single-use" } = options;
  const gate = rows === "reusable" ? anchors.peek(requestId) : anchors.consume(requestId);

  const tag = (span: Span) => {
    span.setAttribute("request.id", requestId);
    span.setAttribute("approved", approved);
  };
  if (gate !== null) await tracer.withSpan("decision", { parent: gate }, tag);
  else await tracer.startRoot("decision", tag);

  const resumed = await run.send({ name: DECISION_EVENT, data: { requestId, approved } });
  return { nested: gate !== null, resumed };
}
