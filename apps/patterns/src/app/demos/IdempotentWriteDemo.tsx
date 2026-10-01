"use client";

import { useState } from "react";
import { createBatchExporter, createTracer, INVALID_TRACE_ID } from "@/lib/harness/span-exporter";
import {
  createMessagesTable,
  type MessageRow,
  type RecordOptions,
  recordReply,
} from "@/lib/idempotent-write/record-reply";

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

type Row = MessageRow & { id: number };

/**
 * Live demo for the `idempotent-write-by-trace-key` doc. A reply row goes
 * into a table with a unique key on its trace id. Record writes the row
 * for the current turn, Retry writes the same row again, as a retried step
 * would, and the table keeps one row because the second write selects the
 * existing one. A new turn is a new trace id and a new row. The zero-id
 * toggle sends the all-zero trace id an untraced process hands out, and the
 * guard stores null instead of a key that every untraced turn would share.
 * The wrong variants show the retry failing and two conversations colliding.
 */
export function IdempotentWriteDemo() {
  const [tracer] = useState(() => createTracer(createBatchExporter()));
  const [table] = useState(() => createMessagesTable());
  const [rows, setRows] = useState<Row[]>([]);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [conversation, setConversation] = useState(1);
  const [zeroId, setZeroId] = useState(false);
  const [guard, setGuard] = useState<NonNullable<RecordOptions["guard"]>>("reject-zero");
  const [conflict, setConflict] = useState<NonNullable<RecordOptions["conflict"]>>("select");
  const [status, setStatus] = useState("No writes yet.");

  const newTrace = async () => {
    const { anchor } = await tracer.startRoot("turn", () => undefined);
    const id = anchor.traceId;
    setTraceId(id);
    return id;
  };

  const write = (conversationId: string, id: string) => {
    const key = zeroId ? INVALID_TRACE_ID : id;
    try {
      const outcome = recordReply(
        table,
        { conversationId, content: `Reply for ${conversationId}`, traceId: key },
        { guard, conflict },
      );
      setRows(table.rows());
      const what =
        outcome.outcome === "inserted"
          ? `inserted row ${outcome.id}`
          : `conflict on the key, selected existing row ${outcome.id}`;
      setStatus(
        `${conversationId}: ${what}.${outcome.warning ? ` Guard: ${outcome.warning}.` : ""}`,
      );
    } catch (error) {
      setStatus(
        `${conversationId}: insert failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const record = async () => {
    const id = traceId ?? (await newTrace());
    write(`conversation-${conversation}`, id);
  };

  const retry = () => {
    if (traceId !== null) write(`conversation-${conversation}`, traceId);
  };

  const nextTurn = async () => {
    const id = await newTrace();
    const next = conversation + 1;
    setConversation(next);
    write(`conversation-${next}`, id);
  };

  const reset = () => {
    table.clear();
    setRows([]);
    setTraceId(null);
    setConversation(1);
    setStatus("No writes yet.");
  };

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={record} className={buttonClass}>
          Record reply
        </button>
        <button type="button" onClick={retry} disabled={traceId === null} className={buttonClass}>
          Retry the write
        </button>
        <button type="button" onClick={nextTurn} className={buttonClass}>
          Reply in another conversation
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={zeroId}
            onChange={(event) => setZeroId(event.target.checked)}
          />
          Send the all-zero trace id (untraced process)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={guard === "accept-zero"}
            onChange={(event) => setGuard(event.target.checked ? "accept-zero" : "reject-zero")}
          />
          Accept the zero id as a key (wrong)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={conflict === "throw"}
            onChange={(event) => setConflict(event.target.checked ? "throw" : "select")}
          />
          Insert without conflict handling (wrong)
        </label>
      </div>

      <p aria-live="polite" className="mt-3">
        {status}{" "}
        {traceId !== null && (
          <span className="text-xs">
            Trace id of the current turn: <code>{zeroId ? INVALID_TRACE_ID : traceId}</code>.
          </span>
        )}
      </p>

      <section aria-label="Messages table" className={`mt-3 ${boxClass}`}>
        <h3 className="font-bold">
          messages <span className="font-normal text-xs">({rows.length} rows)</span>
        </h3>
        {rows.length === 0 ? (
          <p className="mt-1 text-xs">Empty.</p>
        ) : (
          <table className="mt-2 w-full font-mono text-xs">
            <thead>
              <tr className="text-left">
                <th>id</th>
                <th>conversation</th>
                <th>content</th>
                <th>trace_id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.conversationId}</td>
                  <td>{row.content}</td>
                  <td className="[overflow-wrap:anywhere]">{row.traceId ?? "null"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
