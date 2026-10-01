"use client";

import { useState, useSyncExternalStore } from "react";
import { SpanTree } from "@/app/ui/SpanTree";
import {
  type GatedTurn,
  receiveToolCall,
  relayTap,
  type TurnDeps,
} from "@/lib/gated-tool/gated-tool";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import type { LogEntry, RunnerStatus } from "@/lib/harness/step-runner";
import { createChat } from "@/lib/in-band/request";
import { createAnchorsTable } from "@/lib/trace-anchor/anchored-request";

const TODAY = "2026-10-01";

const CALLS = {
  free: {
    label: "Model calls send_link",
    input: { from: "2026-10-06", to: "2026-10-08", email: "ana@example.com" },
  },
  past: {
    label: "Model calls send_link with past dates",
    input: { from: "2026-09-20", to: "2026-09-22", email: "ana@example.com" },
  },
};

const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "No call yet.",
  running: "Running.",
  suspended: "Suspended on wait-for-decision. The function has returned; nothing is running.",
  done: "Done. The model has its tool result.",
  failed: "Failed.",
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

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

/**
 * Live demo for the `human-gated-tool` composite. The first button is the
 * loop reaching a call for the gated tool: the request half from
 * `gated-tool.ts` opens the gate span, re-checks the dates in a step,
 * records the gate's anchor under the correlation id, posts a nudge whose
 * buttons carry that id, and pauses. Tapping a button in the chat is the
 * relay: it parses the id, consumes the anchor row, nests the decision
 * under the gate span, and sends the event. The run half runs only after
 * Approve. Past dates are refused before anyone is nudged. Replay repeats
 * nothing. Every action ends with a flush, as `after()` does for a route.
 */
export function GatedToolDemo({ timeoutMs = 60000 }: { timeoutMs?: number }) {
  const [exporter] = useState(() => createBatchExporter());
  const [deps] = useState<TurnDeps>(() => ({
    tracer: createTracer(exporter),
    anchors: createAnchorsTable(),
    chat: createChat(),
    timeout: timeoutMs,
    today: TODAY,
  }));
  const [turn, setTurn] = useState<GatedTurn | null>(null);
  const [relayLog, setRelayLog] = useState<string[]>([]);

  const subscribe = turn?.run.subscribe ?? NO_SUBSCRIBE;
  const getSnapshot = turn?.run.getSnapshot ?? NO_SNAPSHOT;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const spans = useSyncExternalStore(
    exporter.subscribe,
    exporter.getSnapshot,
    exporter.getSnapshot,
  );
  const messages = useSyncExternalStore(
    deps.chat.subscribe,
    deps.chat.getSnapshot,
    deps.chat.getSnapshot,
  );

  const call = async (which: keyof typeof CALLS) => {
    const next = await receiveToolCall(deps, {
      correlationId: `corr_${Date.now().toString(36)}`,
      input: CALLS[which].input,
    });
    setTurn(next);
    await exporter.flush();
  };

  const tap = async (data: string) => {
    if (turn === null) return;
    const outcome = await relayTap(deps, [turn], data);
    setRelayLog((current) => [
      ...current,
      `tap ${data}: ${outcome.nested ? "decision nested under the gate span" : "no anchor row, decision is its own root"}, ${outcome.resumed ? "resumed the run" : "resumed nothing"}`,
    ]);
    await exporter.flush();
  };

  const replay = async () => {
    await turn?.run.replay();
    await exporter.flush();
  };

  const reset = () => {
    turn?.run.reset();
    setTurn(null);
    exporter.clear();
    deps.chat.clear();
    for (const row of deps.anchors.rows()) deps.anchors.consume(row.requestId);
    setRelayLog([]);
  };

  const status = snapshot?.status ?? "idle";

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => call("free")}
          disabled={turn !== null}
          className={buttonClass}
        >
          {CALLS.free.label}
        </button>
        <button
          type="button"
          onClick={() => call("past")}
          disabled={turn !== null}
          className={buttonClass}
        >
          {CALLS.past.label}
        </button>
        <button
          type="button"
          onClick={replay}
          disabled={turn === null || status === "running"}
          className={buttonClass}
        >
          Replay
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
      </div>

      <p aria-live="polite" className="mt-3">
        {STATUS_TEXT[status]}{" "}
        {turn !== null && (
          <span className="text-xs">
            Trace <code>{turn.anchor.traceId.slice(0, 8)}</code>, correlation id{" "}
            <code>{turn.correlationId}</code>, {deps.anchors.rows().length} anchor row
            {deps.anchors.rows().length === 1 ? "" : "s"}.
          </span>
        )}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <section aria-label="Chat" className={boxClass}>
            <h3 className="font-bold">Chat with the approver</h3>
            {messages.length === 0 ? (
              <p className="mt-1 text-xs">Nothing sent.</p>
            ) : (
              <ol className="mt-2 space-y-2 font-mono text-xs">
                {messages.map((message) => (
                  <li key={message.id} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {message.text}
                    {message.buttons.length > 0 && (
                      <span className="ml-2 inline-flex gap-1">
                        {message.buttons.map((button) => (
                          <button
                            key={button.data}
                            type="button"
                            onClick={() => tap(button.data)}
                            className={buttonClass}
                          >
                            {button.label}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {relayLog.length > 0 && (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {relayLog.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Tool result" className={boxClass}>
            <h3 className="font-bold">What the model gets as the tool result</h3>
            <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">
              {status === "done" && snapshot
                ? JSON.stringify(snapshot.result?.output)
                : "Nothing yet."}
            </p>
          </section>
        </div>
        <div className="space-y-3">
          <section aria-label="Span tree" className={boxClass}>
            <h3 className="font-bold">
              Spans at the backend{" "}
              <span className="font-normal text-xs">({spans.exported.length})</span>
            </h3>
            <SpanTree spans={spans.exported} />
          </section>
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
        </div>
      </div>
    </div>
  );
}
