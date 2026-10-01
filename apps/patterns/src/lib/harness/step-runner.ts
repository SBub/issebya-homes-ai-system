/**
 * An in-memory durable step runner for the agent harness demos. It keeps
 * the rules of a real runner such as Inngest that the docs depend on, and
 * nothing else:
 *
 * - `step.run(id, fn)` runs `fn` once and memoizes its result by id. On a
 *   replay the memoized result returns at once and `fn` never runs again.
 * - `step.waitForEvent(id, options)` ends the invocation (the function
 *   "suspends"). When a matching event arrives, or the timeout elapses, the
 *   result is memoized under the id and the function is replayed from the
 *   top. An event matches when its name equals `options.event` and the
 *   value at `options.match` (a path such as `data.id`) equals the same
 *   path's value on the triggering event.
 * - A replay re-invokes the function from its first line. Code outside a
 *   step runs again on every invocation; only steps are skipped.
 * - A step tool called from inside another step's callback throws. The
 *   callback must be self-contained.
 *
 * Unlike Inngest, `run` continues in the same invocation instead of
 * scheduling a fresh one per step. Nothing in the docs depends on that
 * difference; `replay()` exists so a demo can show one on demand.
 */

export type StepEvent = { name: string; data: Record<string, unknown> };

type WaitOptions = { event: string; match: string; timeout: number };

export type StepTools = {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
  waitForEvent(id: string, options: WaitOptions): Promise<StepEvent | null>;
};

export type DurableFunction<T> = (input: { event: StepEvent; step: StepTools }) => Promise<T>;

export type RunnerStatus = "idle" | "running" | "suspended" | "done" | "failed";

type InvocationReason = "start" | "replay" | "event" | "timeout";

export type LogEntry =
  | { kind: "invocation"; number: number; reason: InvocationReason }
  | { kind: "step"; id: string; outcome: "ran" | "memoized" }
  | { kind: "wait"; id: string; outcome: "suspended" | "memoized" }
  | { kind: "event"; name: string; outcome: "matched" | "ignored" }
  | { kind: "timeout"; id: string }
  | { kind: "done" }
  | { kind: "failed"; error: string };

type PendingWait = { id: string; event: string; match: string; value: unknown };

type RunnerSnapshot<T> = {
  status: RunnerStatus;
  invocations: number;
  log: LogEntry[];
  memo: Array<{ id: string; value: unknown }>;
  pendingWait: PendingWait | null;
  result: T | undefined;
  error: string | null;
};

export type DurableRun<T> = {
  /** The first invocation. Only from `idle`. */
  start(): Promise<void>;
  /** Re-invokes the function from the top with every memoized step answering at once. Not while running. */
  replay(): Promise<void>;
  /** Delivers an event. Returns true when it resumed the pending wait. */
  send(event: StepEvent): Promise<boolean>;
  /** Clears the timer and the memo, back to `idle`. */
  reset(): void;
  getSnapshot(): RunnerSnapshot<T>;
  subscribe(listener: () => void): () => void;
};

const IDLE = <T>(): RunnerSnapshot<T> => ({
  status: "idle",
  invocations: 0,
  log: [],
  memo: [],
  pendingWait: null,
  result: undefined,
  error: null,
});

/** Thrown by `waitForEvent` to end the invocation; never seen by user code that awaits the step. */
class Suspend {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  /** What an ambient span sees when the invocation ends through it. */
  toString() {
    return `invocation ended on wait "${this.id}"`;
  }
}

function valueAt(event: StepEvent, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current !== null && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, event);
}

export function createStepRunner<T>(
  fn: DurableFunction<T>,
  options: { trigger: StepEvent },
): DurableRun<T> {
  const { trigger } = options;
  const listeners = new Set<() => void>();
  const memo = new Map<string, unknown>();
  let log: LogEntry[] = [];
  let status: RunnerStatus = "idle";
  let invocations = 0;
  let result: T | undefined;
  let error: string | null = null;
  let pending: (PendingWait & { timer: ReturnType<typeof setTimeout> }) | null = null;
  let snapshot: RunnerSnapshot<T> = IDLE();

  function emit() {
    snapshot = {
      status,
      invocations,
      log,
      memo: [...memo].map(([id, value]) => ({ id, value })),
      pendingWait: pendingView(),
      result,
      error,
    };
    for (const listener of listeners) listener();
  }

  function pendingView(): PendingWait | null {
    if (pending === null) return null;
    const { id, event, match, value } = pending;
    return { id, event, match, value };
  }

  function record(entry: LogEntry) {
    log = [...log, entry];
  }

  async function invoke(reason: InvocationReason) {
    invocations += 1;
    status = "running";
    record({ kind: "invocation", number: invocations, reason });
    emit();

    // The id of the step whose callback is running, so the refusal can name it.
    let runningStep: string | null = null;

    const refuseNested = (id: string) => {
      if (runningStep !== null) {
        throw new Error(
          `step "${id}" was called inside step "${runningStep}": a step callback must not call step tools`,
        );
      }
    };

    const step: StepTools = {
      async run(id, callback) {
        refuseNested(id);
        if (memo.has(id)) {
          record({ kind: "step", id, outcome: "memoized" });
          emit();
          return memo.get(id) as Awaited<ReturnType<typeof callback>>;
        }
        runningStep = id;
        try {
          const value = await callback();
          memo.set(id, value);
          record({ kind: "step", id, outcome: "ran" });
          emit();
          return value;
        } finally {
          runningStep = null;
        }
      },
      async waitForEvent(id, waitOptions) {
        refuseNested(id);
        if (memo.has(id)) {
          record({ kind: "wait", id, outcome: "memoized" });
          emit();
          return memo.get(id) as StepEvent | null;
        }
        if (pending === null) {
          const timer = setTimeout(() => {
            if (pending?.id !== id) return;
            pending = null;
            memo.set(id, null);
            record({ kind: "timeout", id });
            void invoke("timeout");
          }, waitOptions.timeout);
          pending = {
            id,
            event: waitOptions.event,
            match: waitOptions.match,
            value: valueAt(trigger, waitOptions.match),
            timer,
          };
        }
        record({ kind: "wait", id, outcome: "suspended" });
        throw new Suspend(id);
      },
    };

    try {
      result = await fn({ event: trigger, step });
      status = "done";
      record({ kind: "done" });
    } catch (thrown) {
      if (thrown instanceof Suspend) {
        status = "suspended";
      } else {
        status = "failed";
        error = thrown instanceof Error ? thrown.message : String(thrown);
        record({ kind: "failed", error });
      }
    }
    emit();
  }

  return {
    async start() {
      if (status !== "idle") return;
      await invoke("start");
    },
    async replay() {
      if (status === "running" || status === "idle") return;
      await invoke("replay");
    },
    async send(event) {
      const wait = pending;
      const matches =
        wait !== null && event.name === wait.event && valueAt(event, wait.match) === wait.value;
      if (!matches) {
        record({ kind: "event", name: event.name, outcome: "ignored" });
        emit();
        return false;
      }
      clearTimeout(wait.timer);
      pending = null;
      memo.set(wait.id, event);
      record({ kind: "event", name: event.name, outcome: "matched" });
      await invoke("event");
      return true;
    },
    reset() {
      if (pending !== null) clearTimeout(pending.timer);
      pending = null;
      memo.clear();
      log = [];
      status = "idle";
      invocations = 0;
      result = undefined;
      error = null;
      emit();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
