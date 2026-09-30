"use client";

import { useSyncExternalStore } from "react";
import {
  disconnect,
  getServerSnapshot,
  getSnapshot,
  run,
  type Status,
  subscribe,
} from "@/lib/sse/progress-store";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Not started.",
  running: "Streaming.",
  disconnected: "Disconnected. Run demo again to resume.",
  done: "Done. The server sent the done event and closed the stream.",
  error: "The connection failed and the browser gave up.",
};

/**
 * Live demo for the `sse-route-handler` doc: the `EventSource` on
 * /api/demo/progress lives in `progress-store.ts`, and this component reads
 * its snapshot with `useSyncExternalStore`. Run demo fills a bar on each
 * `progress` event and lists them; after Disconnect, the next run resumes by
 * passing the last id it saw. Unmounting unsubscribes, which closes the
 * connection.
 */
export function SseProgressDemo() {
  const { status, percent, entries } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
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
