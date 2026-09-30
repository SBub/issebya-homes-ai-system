"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "running" | "disconnected" | "done" | "error";

type Entry =
  | { kind: "event"; id: string; percent: number; step: string }
  | { kind: "resume"; afterId: string };

const STATUS_TEXT: Record<Status, string> = {
  idle: "Not started.",
  running: "Streaming.",
  disconnected: "Disconnected. Run demo again to resume.",
  done: "Done. The server sent the done event and closed the stream.",
  error: "The connection failed and the browser gave up.",
};

/**
 * Live demo for the `sse-route-handler` doc: opens an `EventSource` on
 * /api/demo/progress, fills a bar on each `progress` event and lists them.
 * After Disconnect, the next run resumes by passing the last id it saw.
 */
export function SseProgressDemo() {
  const sourceRef = useRef<EventSource | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [percent, setPercent] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);

  // The one effect: close the connection when the doc unmounts.
  useEffect(() => () => sourceRef.current?.close(), []);

  function run() {
    const resumeAfter = status === "disconnected" || status === "error" ? lastId : null;
    if (resumeAfter) {
      setEntries((prev) => [...prev, { kind: "resume", afterId: resumeAfter }]);
    } else {
      setEntries([]);
      setPercent(0);
      setLastId(null);
    }

    const source = new EventSource(
      resumeAfter
        ? `/api/demo/progress?lastEventId=${encodeURIComponent(resumeAfter)}`
        : "/api/demo/progress",
    );
    sourceRef.current = source;
    setStatus("running");

    source.addEventListener("progress", (event) => {
      const { percent, step } = JSON.parse(event.data) as { percent: number; step: string };
      setPercent(percent);
      setEntries((prev) => [...prev, { kind: "event", id: event.lastEventId, percent, step }]);
      setLastId(event.lastEventId);
    });
    source.addEventListener("done", () => {
      source.close();
      setStatus("done");
      setLastId(null);
    });
    source.addEventListener("error", () => {
      // While the browser is reconnecting on its own (sending Last-Event-ID)
      // the state is CONNECTING; only CLOSED means it gave up.
      if (source.readyState === EventSource.CLOSED) setStatus("error");
    });
  }

  function disconnect() {
    sourceRef.current?.close();
    setStatus("disconnected");
  }

  const running = status === "running";

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div
        role="progressbar"
        aria-label="Demo progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 w-full overflow-hidden rounded-sm border border-gray-300 bg-white/70"
      >
        <div
          className="h-full bg-shop-ground transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p aria-live="polite" className="mt-3">
        {STATUS_TEXT[status]}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
        >
          Run demo
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={!running}
          className="rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>

      {entries.length > 0 && (
        <ol aria-label="Received events" className="mt-3 space-y-1 font-mono text-xs">
          {entries.map((entry, index) =>
            entry.kind === "event" ? (
              <li key={`event-${entry.id}-${index}`}>
                id {entry.id}: {entry.percent}%, {entry.step}
              </li>
            ) : (
              <li key={`resume-${entry.afterId}-${index}`} className="italic">
                Resumed after id {entry.afterId}
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
