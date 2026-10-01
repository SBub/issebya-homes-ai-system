"use client";

import { useState, useSyncExternalStore } from "react";
import { SpanTree } from "@/app/ui/SpanTree";
import { decideTurn, receiveMessage, type Turn, type TurnDeps } from "@/lib/durable-turn/turn";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import type { LogEntry, RunnerStatus } from "@/lib/harness/step-runner";
import { createMessagesTable, recordReply } from "@/lib/idempotent-write/record-reply";
import { createAnchorsTable } from "@/lib/trace-anchor/anchored-request";

const CONVERSATION_ID = "conversation-1";
const TEXT = "Is the 6th to the 8th free? Send me the link.";

const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "No message yet.",
  running: "Running.",
  suspended: "Suspended on wait-for-decision. The function has returned; nothing is running.",
  done: "Done. The reply is recorded and sent.",
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
 * Live demo for the `durable-agent-turn` composite. Receive plays the
 * ingress route: a root span, the inbound row, the durable function started
 * with the root's anchor and a correlation id in its event; the function
 * runs the loop in stepped spans until the gated tool pauses it. Approve
 * and Reject play the resume route. Replay re-invokes the function and
 * nothing repeats. Retry writes the reply row again with the turn's trace
 * id and gets the existing row back. Every action ends with a flush, as
 * `after()` does for a route, so the tree shows what reached the backend.
 */
export function DurableTurnDemo({ timeoutMs = 20000 }: { timeoutMs?: number }) {
  const [notifications, setNotifications] = useState<string[]>([]);
  const [deps] = useState<TurnDeps>(() => {
    const exporter = createBatchExporter();
    return {
      tracer: createTracer(exporter),
      exporter,
      messages: createMessagesTable(),
      anchors: createAnchorsTable(),
      notify: (text) => setNotifications((current) => [...current, text]),
      timeout: timeoutMs,
    };
  });
  const [turn, setTurn] = useState<Turn | null>(null);
  const [rows, setRows] = useState(() => deps.messages.rows());
  const [writes, setWrites] = useState<string[]>([]);

  const subscribe = turn?.run.subscribe ?? NO_SUBSCRIBE;
  const getSnapshot = turn?.run.getSnapshot ?? NO_SNAPSHOT;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const spans = useSyncExternalStore(
    deps.exporter.subscribe,
    deps.exporter.getSnapshot,
    deps.exporter.getSnapshot,
  );

  // What a route does in after(): send the batch once the response is out.
  const flush = async () => {
    await deps.exporter.flush();
    setRows(deps.messages.rows());
  };

  const receive = async () => {
    const next = await receiveMessage(deps, {
      conversationId: CONVERSATION_ID,
      text: TEXT,
      correlationId: `corr_${Date.now().toString(36)}`,
    });
    setTurn(next);
    await flush();
  };

  const decide = async (approved: boolean) => {
    if (turn === null) return;
    await decideTurn(deps, turn, approved);
    await flush();
  };

  const replay = async () => {
    await turn?.run.replay();
    await flush();
  };

  const retryWrite = () => {
    if (turn === null || snapshot?.status !== "done") return;
    const result = snapshot.result;
    if (result === undefined) return;
    const outcome = recordReply(deps.messages, {
      conversationId: CONVERSATION_ID,
      content: result.replyText,
      traceId: turn.anchor.traceId,
    });
    setWrites((current) => [
      ...current,
      `retry ${current.length + 1}: ${outcome.outcome === "existing" ? `conflict on the trace id, existing row ${outcome.id} returned` : `inserted row ${outcome.id}`}`,
    ]);
    setRows(deps.messages.rows());
  };

  const reset = () => {
    turn?.run.reset();
    setTurn(null);
    deps.exporter.clear();
    deps.messages.clear();
    for (const row of deps.anchors.rows()) deps.anchors.consume(row.requestId);
    setRows([]);
    setWrites([]);
    setNotifications([]);
  };

  const status = snapshot?.status ?? "idle";

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={receive} disabled={turn !== null} className={buttonClass}>
          Receive message
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={status !== "suspended"}
          className={buttonClass}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={status !== "suspended"}
          className={buttonClass}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={replay}
          disabled={turn === null || status === "running"}
          className={buttonClass}
        >
          Replay
        </button>
        <button
          type="button"
          onClick={retryWrite}
          disabled={status !== "done"}
          className={buttonClass}
        >
          Retry the reply write
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
            <code>{turn.correlationId}</code>.
          </span>
        )}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <section aria-label="Span tree" className={boxClass}>
            <h3 className="font-bold">
              Spans at the backend{" "}
              <span className="font-normal text-xs">
                ({spans.exported.length} exported, {spans.pending.length} pending)
              </span>
            </h3>
            <SpanTree spans={spans.exported} />
          </section>
          <section aria-label="Messages table" className={boxClass}>
            <h3 className="font-bold">
              messages <span className="font-normal text-xs">({rows.length} rows)</span>
            </h3>
            {rows.length === 0 ? (
              <p className="mt-1 text-xs">Empty.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {rows.map((row) => (
                  <li key={row.id}>
                    {row.role}: {row.content}{" "}
                    <span className="text-gray-600">
                      trace {row.traceId === null ? "null" : row.traceId.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {writes.length > 0 && (
              <ul className="mt-2 list-disc pl-5 font-mono text-xs space-y-1">
                {writes.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
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
          <section aria-label="Notifications" className={boxClass}>
            <h3 className="font-bold">Sent to the channel and the approver</h3>
            {notifications.length === 0 ? (
              <p className="mt-1 text-xs">Nothing yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {notifications.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
