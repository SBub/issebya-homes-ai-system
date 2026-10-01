"use client";

import { useState, useSyncExternalStore } from "react";
import { SpanTree } from "@/app/ui/SpanTree";
import { createBatchExporter, createTracer, type TraceAnchor } from "@/lib/harness/span-exporter";
import { createStepRunner, type LogEntry, type RunnerStatus } from "@/lib/harness/step-runner";
import {
  createAnchorsTable,
  createRequestFunction,
  type RequestResult,
  resumeRequest,
} from "@/lib/trace-anchor/anchored-request";

const REQUEST_ID = "req_1";

const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "Not started.",
  running: "Running.",
  suspended: "Suspended on wait-for-decision. No span is open; the anchor is data in the event.",
  done: "Done.",
  failed: "Failed.",
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

// Stable stand-ins while no run exists, so the store hook does not resubscribe every render.
const NO_SUBSCRIBE = () => () => {};
const NO_SNAPSHOT = () => null;

function describe(entry: LogEntry): string {
  switch (entry.kind) {
    case "invocation":
      return `invocation ${entry.number} (${entry.reason})`;
    case "step":
      return `step ${entry.id}: ${entry.outcome}`;
    case "wait":
      return `wait ${entry.id}: ${entry.outcome}`;
    case "event":
      return `event ${entry.name}: ${entry.outcome}`;
    case "timeout":
      return `wait ${entry.id}: timed out`;
    case "done":
      return "function returned";
    case "failed":
      return `function threw: ${entry.error}`;
  }
}

type Context = "anchor" | "ambient";
type Rows = "single-use" | "reusable";

/**
 * Live demo for the `trace-anchor-across-steps` doc. Start plays the route
 * that receives a request: it opens the root span and starts the function
 * with the root's `{ traceId, spanId }` in the event. Each step opens its
 * own child span under that anchor, the gate step records its span's anchor
 * in a row keyed by the request id, and the function pauses. Approve plays
 * the resume route: it consumes the row, nests the decision under the gate
 * span, and sends the event. The tree is read from the exporter. On ambient
 * context the replay opens a second root and the trace splits; with a
 * reusable row a second Approve nests a stray decision under the finished
 * gate.
 */
export function TraceAnchorDemo({ timeoutMs = 20000 }: { timeoutMs?: number }) {
  const [exporter] = useState(() => createBatchExporter());
  const [tracer] = useState(() => createTracer(exporter));
  const [anchors] = useState(() => createAnchorsTable());
  const [context, setContext] = useState<Context>("anchor");
  const [rows, setRows] = useState<Rows>("single-use");
  const [notifications, setNotifications] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [runner, setRunner] = useState<ReturnType<typeof createStepRunner<RequestResult>> | null>(
    null,
  );

  const subscribe = runner?.subscribe ?? NO_SUBSCRIBE;
  const getSnapshot = runner?.getSnapshot ?? NO_SNAPSHOT;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const spans = useSyncExternalStore(
    exporter.subscribe,
    exporter.getSnapshot,
    exporter.getSnapshot,
  );

  const start = async () => {
    // The route's root span, ended before the function starts. Its anchor travels as data.
    const { anchor } = await tracer.startRoot("request.received", (span) => {
      span.setAttribute("request.id", REQUEST_ID);
    });
    const traceAnchor: TraceAnchor = anchor;
    const next = createStepRunner(
      createRequestFunction({
        tracer,
        anchors,
        context,
        timeout: timeoutMs,
        notify: (text) => setNotifications((current) => [...current, text]),
      }),
      {
        trigger: { name: "request.received", data: { requestId: REQUEST_ID, traceAnchor } },
      },
    );
    setRunner(next);
    await next.start();
  };

  const approve = async () => {
    if (runner === null) return;
    const { nested, resumed } = await resumeRequest({
      tracer,
      anchors,
      run: runner,
      requestId: REQUEST_ID,
      approved: true,
      rows,
    });
    setDecisions((current) => [
      ...current,
      `decision ${current.length + 1}: ${nested ? "nested under the gate span" : "no anchor row, its own root"}, ${resumed ? "resumed the run" : "resumed nothing"}`,
    ]);
  };

  const reset = () => {
    runner?.reset();
    setRunner(null);
    exporter.clear();
    for (const row of anchors.rows()) anchors.consume(row.requestId);
    setNotifications([]);
    setDecisions([]);
  };

  const switchContext = (next: Context) => {
    reset();
    setContext(next);
  };

  const status = snapshot?.status ?? "idle";
  const allSpans = [...spans.exported, ...spans.pending];
  const anchorRows = anchors.rows().length;

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={start} disabled={runner !== null} className={buttonClass}>
          Start
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={runner === null || status === "running"}
          className={buttonClass}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => runner?.replay()}
          disabled={runner === null || status === "running"}
          className={buttonClass}
        >
          Replay
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={context === "ambient"}
            onChange={(event) => switchContext(event.target.checked ? "ambient" : "anchor")}
          />
          Rely on ambient context across steps (wrong)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rows === "reusable"}
            onChange={(event) => setRows(event.target.checked ? "reusable" : "single-use")}
          />
          Keep the anchor row after reading it (wrong)
        </label>
      </div>

      <p aria-live="polite" className="mt-3">
        {STATUS_TEXT[status]}{" "}
        <span className="text-xs">
          {allSpans.length} spans, {anchorRows} anchor {anchorRows === 1 ? "row" : "rows"}.
        </span>
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Span tree" className={boxClass}>
          <h3 className="font-bold">Span tree, from the exporter</h3>
          <SpanTree spans={allSpans} />
        </section>
        <div className="space-y-3">
          <section aria-label="Runner log" className={boxClass}>
            <h3 className="font-bold">Log</h3>
            {snapshot === null ? (
              <p className="mt-1 text-xs">Nothing yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {snapshot.log.map((entry, index) => (
                  <li key={index}>{describe(entry)}</li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Decisions" className={boxClass}>
            <h3 className="font-bold">Resume route calls</h3>
            {decisions.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {decisions.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Notifications" className={boxClass}>
            <h3 className="font-bold">Notifications</h3>
            {notifications.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {notifications.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
            )}
          </section>
          {status === "done" && snapshot && (
            <section aria-label="Result" className={boxClass}>
              <h3 className="font-bold">Result</h3>
              <p className="mt-1 font-mono text-xs">{JSON.stringify(snapshot.result)}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
