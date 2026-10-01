"use client";

import { useState, useSyncExternalStore } from "react";
import { createStepRunner, type LogEntry, type RunnerStatus } from "@/lib/harness/step-runner";
import { createTurnFunction, type TurnMode } from "@/lib/stepped-effects/turn";

const TRIGGER = { name: "message.received", data: { text: "Is the 6th to the 8th free?" } };

const MODES: Array<{ value: TurnMode; label: string }> = [
  { value: "stepped", label: "Every side effect in its own step" },
  { value: "send-unstepped", label: "Send outside a step (wrong)" },
  { value: "prompt-in-loop", label: "Prompt fetched in the loop, unstepped (wrong)" },
  { value: "nested", label: "Send inside the model step (wrong)" },
];

const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "Not started.",
  running: "Running.",
  suspended: "Suspended.",
  done: "Done.",
  failed: "Failed.",
};

const boxClass = "rounded-sm border border-gray-300 bg-white/70 p-3";
const buttonClass = "rounded-sm border border-gray-300 bg-white px-3 py-1 disabled:opacity-50";

function describe(entry: LogEntry): string {
  switch (entry.kind) {
    case "invocation":
      return `invocation ${entry.number} (${entry.reason}): the function runs from the top`;
    case "step":
      return entry.outcome === "ran"
        ? `step ${entry.id}: ran, result memoized`
        : `step ${entry.id}: memoized, callback skipped`;
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
 * Live demo for the `step-memoized-side-effects` doc. The turn from
 * `turn.ts` runs on the harness step runner: a prompt fetch, two model
 * rounds, a tool round and a send, each in its own step. Run performs them
 * once; Replay runs the function from the top and the log shows every step
 * answering from the memo while the side-effect list stays the same length.
 * The wrong variants show a send that goes out twice, a prompt fetched once
 * more per finished round, and a step inside a step refused.
 */
export function SteppedEffectsDemo() {
  const [mode, setMode] = useState<TurnMode>("stepped");
  const [effects, setEffects] = useState<Array<{ invocation: number; text: string }>>([]);

  const make = (nextMode: TurnMode) => {
    let invocation = 0;
    const runner = createStepRunner(
      createTurnFunction({
        mode: nextMode,
        record: (text) => setEffects((current) => [...current, { invocation, text }]),
      }),
      { trigger: TRIGGER },
    );
    runner.subscribe(() => {
      invocation = runner.getSnapshot().invocations;
    });
    return runner;
  };
  const [runner, setRunner] = useState(() => make("stepped"));
  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);

  const switchMode = (nextMode: TurnMode) => {
    runner.reset();
    setEffects([]);
    setMode(nextMode);
    setRunner(make(nextMode));
  };

  const reset = () => {
    runner.reset();
    setEffects([]);
  };

  const { status, invocations, log, memo, result } = snapshot;
  const sends = effects.filter((effect) => effect.text.startsWith("send reply")).length;
  const fetches = effects.filter((effect) => effect.text === "fetch prompt").length;

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => runner.start()}
          disabled={status !== "idle"}
          className={buttonClass}
        >
          Run
        </button>
        <button
          type="button"
          onClick={() => runner.replay()}
          disabled={status === "idle" || status === "running"}
          className={buttonClass}
        >
          Replay
        </button>
        <button type="button" onClick={reset} className={buttonClass}>
          Reset
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs">
          Variant
          <select
            value={mode}
            onChange={(event) => switchMode(event.target.value as TurnMode)}
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
        {STATUS_TEXT[status]}{" "}
        <span className="text-xs">
          {invocations} invocations, {fetches} prompt fetches, {sends} replies sent.
        </span>
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Runner log" className={boxClass}>
          <h3 className="font-bold">Log</h3>
          <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
            {log.map((entry, index) => (
              <li key={index}>{describe(entry)}</li>
            ))}
          </ol>
        </section>
        <div className="space-y-3">
          <section aria-label="Side effects" className={boxClass}>
            <h3 className="font-bold">Side effects, as they happened</h3>
            {effects.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
                {effects.map((effect, index) => (
                  <li key={index}>
                    invocation {effect.invocation}: {effect.text}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label="Memoized steps" className={boxClass}>
            <h3 className="font-bold">Memoized steps</h3>
            {memo.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 font-mono text-xs space-y-1">
                {memo.map((entry) => (
                  <li key={entry.id}>{entry.id}</li>
                ))}
              </ul>
            )}
          </section>
          {status === "done" && (
            <section aria-label="Result" className={boxClass}>
              <h3 className="font-bold">Result</h3>
              <p className="mt-1 font-mono text-xs">{JSON.stringify(result)}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
