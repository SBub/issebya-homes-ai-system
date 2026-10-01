"use client";

import { useState, useSyncExternalStore } from "react";
import { type FlushMode, handleRequest, type RequestOutcome } from "@/lib/flush/handle-request";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";

const MODES: Array<{ value: FlushMode; label: string }> = [
  { value: "none", label: "No flush (wrong)" },
  { value: "after", label: "Flush in after(), once the response is sent" },
  { value: "before-response", label: "Flush before the response (slow)" },
];

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

/**
 * Live demo for the `flush-before-freeze` doc. Each click is one request on
 * a model of a serverless platform: the handler emits three spans into a
 * batch exporter, the response goes out, the `after` callbacks run, and the
 * process is frozen. The exporter sends only on a flush, and a flush takes a
 * round trip. With no flush the freeze drops the queue and the backend
 * stays empty. A flush in `after()` lands every span without delaying the
 * response. A flush before the response lands them too, and the response
 * waits for the round trip.
 */
export function FlushDemo({ delayMs = 300 }: { delayMs?: number }) {
  const [exporter] = useState(() => createBatchExporter({ delay: delayMs }));
  const [tracer] = useState(() => createTracer(exporter));
  const [mode, setMode] = useState<FlushMode>("none");
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<Array<RequestOutcome & { mode: FlushMode }>>([]);
  const snapshot = useSyncExternalStore(
    exporter.subscribe,
    exporter.getSnapshot,
    exporter.getSnapshot,
  );

  const send = async () => {
    setBusy(true);
    const outcome = await handleRequest({ tracer, exporter, flush: mode });
    setRequests((current) => [...current, { ...outcome, mode }]);
    setBusy(false);
  };

  const reset = () => {
    exporter.clear();
    setRequests([]);
  };

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={send} disabled={busy} className={buttonClass}>
          Send a request
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs">
          Flush
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as FlushMode)}
            className="rounded-sm border border-gray-300 bg-white px-2 py-1"
          >
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p aria-live="polite" className="mt-3">
        {requests.length === 0
          ? "No requests yet."
          : `${requests.length} ${requests.length === 1 ? "request" : "requests"}. Last response: ${requests.at(-1)?.status} in ${requests.at(-1)?.responseMs} ms.`}{" "}
        <span className="text-xs">The export round trip takes {delayMs} ms.</span>
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Backend" className={boxClass}>
          <h3 className="font-bold">
            Spans at the backend{" "}
            <span className="font-normal text-xs">
              ({snapshot.exported.length} exported in {snapshot.flushes}{" "}
              {snapshot.flushes === 1 ? "flush" : "flushes"}, {snapshot.dropped.length} dropped by a
              freeze)
            </span>
          </h3>
          {snapshot.exported.length === 0 ? (
            <p className="mt-1 text-xs">Nothing arrived.</p>
          ) : (
            <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
              {snapshot.exported.map((span) => (
                <li key={span.spanId}>{span.name}</li>
              ))}
            </ol>
          )}
        </section>
        <section aria-label="Requests" className={boxClass}>
          <h3 className="font-bold">Requests</h3>
          {requests.length === 0 ? (
            <p className="mt-1 text-xs">None yet.</p>
          ) : (
            <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
              {requests.map((request, index) => (
                <li key={index}>
                  {request.mode}: {request.status} in {request.responseMs} ms, then{" "}
                  {request.exported} exported, {request.dropped} dropped
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
