/**
 * The state behind the `sse-route-handler` demo, held outside React and read
 * with `useSyncExternalStore`. The `EventSource` is opened by `run`, closed
 * by `disconnect`, by the `done` event, or when the last subscriber leaves
 * (the doc unmounted). Leaving also forgets the run, so the next mount starts
 * idle, as a component's own state would.
 */

export type Status = "idle" | "running" | "disconnected" | "done" | "error";

type Entry =
  | { kind: "event"; id: string; percent: number; step: string }
  | { kind: "resume"; afterId: string };

type ProgressSnapshot = {
  status: Status;
  percent: number;
  entries: Entry[];
  lastId: string | null;
};

const INITIAL: ProgressSnapshot = { status: "idle", percent: 0, entries: [], lastId: null };

let snapshot = INITIAL;
let source: EventSource | null = null;
const listeners = new Set<() => void>();

// A new object per change and the same one in between: `useSyncExternalStore`
// compares snapshots with `Object.is`, so a mutation in place would go unseen
// and a fresh object per read would render forever.
function update(patch: Partial<ProgressSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      source?.close();
      source = null;
      snapshot = INITIAL;
    }
  };
}

export function getSnapshot() {
  return snapshot;
}

export function getServerSnapshot() {
  return INITIAL;
}

export function run() {
  const { status, lastId, entries } = snapshot;
  const resumeAfter = status === "disconnected" || status === "error" ? lastId : null;
  if (resumeAfter) {
    update({ status: "running", entries: [...entries, { kind: "resume", afterId: resumeAfter }] });
  } else {
    update({ status: "running", percent: 0, entries: [], lastId: null });
  }

  const events = new EventSource(
    resumeAfter
      ? `/api/demo/progress?lastEventId=${encodeURIComponent(resumeAfter)}`
      : "/api/demo/progress",
  );
  source = events;

  events.addEventListener("progress", (event) => {
    const { percent, step } = JSON.parse(event.data) as { percent: number; step: string };
    update({
      percent,
      lastId: event.lastEventId,
      entries: [...snapshot.entries, { kind: "event", id: event.lastEventId, percent, step }],
    });
  });
  events.addEventListener("done", () => {
    events.close();
    update({ status: "done", lastId: null });
  });
  events.addEventListener("error", () => {
    // While the browser is reconnecting on its own (sending Last-Event-ID)
    // the state is CONNECTING; only CLOSED means it gave up.
    if (events.readyState === EventSource.CLOSED) update({ status: "error" });
  });
}

export function disconnect() {
  source?.close();
  update({ status: "disconnected" });
}
