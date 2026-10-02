"use client";

import { useState, useSyncExternalStore } from "react";
import { createGatedFunction, DECISION_EVENT, type GateOptions } from "@/lib/approval/gate";
import { createStepRunner, type LogEntry, type RunnerStatus } from "@/lib/harness/step-runner";

const TRIGGER = {
  name: "request.received",
  data: { requestId: "req_1", reason: "send the link for the 6th to the 8th" },
};

const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "Not started.",
  running: "Running.",
  suspended: "Suspended on wait-for-decision. The function has returned; nothing is running.",
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
      return entry.outcome === "suspended"
        ? `wait ${entry.id}: no decision yet, invocation ends`
        : `wait ${entry.id}: memoized, returns at once`;
    case "event":
      return `event ${entry.name}: ${entry.outcome}`;
    case "timeout":
      return `wait ${entry.id}: timed out, resumes with null`;
    case "done":
      return "function returned";
    case "failed":
      return `function threw: ${entry.error}`;
  }
}

type Nudge = NonNullable<GateOptions["nudge"]>;

/**
 * Live demo for the `approval-gate-wait-for-event` doc. The gated function
 * from `gate.ts` runs on the harness step runner: Start nudges the approver
 * in its own step and suspends on `waitForEvent`; Approve and Reject send
 * the decision event matched on the request id; Replay re-invokes the
 * function from the top and the log shows the memoized steps answering
 * without running. The timeout resumes the wait with null, which the gate
 * turns into the not-approved result. The "unstepped" variant sends the
 * nudge from plain function code, so a replay sends it again.
 */
export function ApprovalGateDemo({ timeoutMs = 20000 }: { timeoutMs?: number }) {
  const [notifications, setNotifications] = useState<string[]>([]);
  const [nudge, setNudge] = useState<Nudge>("own-step");

  const make = (mode: Nudge) =>
    createStepRunner(
      createGatedFunction({
        timeout: timeoutMs,
        nudge: mode,
        notify: (text) => setNotifications((current) => [...current, text]),
      }),
      { trigger: TRIGGER },
    );
  const [runner, setRunner] = useState(() => make("own-step"));
  const snapshot = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);

  const decide = (approved: boolean) =>
    runner.send({ name: DECISION_EVENT, data: { requestId: TRIGGER.data.requestId, approved } });

  const reset = () => {
    runner.reset();
    setNotifications([]);
  };

  const switchNudge = (mode: Nudge) => {
    runner.reset();
    setNotifications([]);
    setNudge(mode);
    setRunner(make(mode));
  };

  const { status, invocations, pendingWait, log, memo, result } = snapshot;

  return (
    <div className="mb-4 w-full rounded-sm border border-gray-300 bg-shop-card p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => runner.start()}
          disabled={status !== "idle"}
          className={buttonClass}
        >
          Start
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
          <input
            type="checkbox"
            checked={nudge === "unstepped"}
            onChange={(event) => switchNudge(event.target.checked ? "unstepped" : "own-step")}
          />
          Send the nudge outside a step (wrong)
        </label>
      </div>

      <p aria-live="polite" className="mt-3">
        {STATUS_TEXT[status]}{" "}
        {status === "suspended" && pendingWait && (
          <span className="text-xs">
            Waiting for <code>{pendingWait.event}</code> where <code>{pendingWait.match}</code> is{" "}
            <code>{String(pendingWait.value)}</code>, for up to {Math.round(timeoutMs / 1000)} s.
          </span>
        )}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-label="Runner log" className={boxClass}>
          <h3 className="font-bold">
            Log <span className="font-normal text-xs">({invocations} invocations)</span>
          </h3>
          <ol className="mt-2 list-decimal pl-5 font-mono text-xs space-y-1">
            {log.map((entry, index) => (
              <li key={index}>{describe(entry)}</li>
            ))}
          </ol>
        </section>
        <div className="space-y-3">
          <section aria-label="Notifications" className={boxClass}>
            <h3 className="font-bold">Notifications sent to the approver</h3>
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
          <section aria-label="Memoized steps" className={boxClass}>
            <h3 className="font-bold">Memoized steps</h3>
            {memo.length === 0 ? (
              <p className="mt-1 text-xs">None yet.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 font-mono text-xs space-y-1">
                {memo.map((entry) => (
                  <li key={entry.id} className="[overflow-wrap:anywhere]">
                    {entry.id} = {JSON.stringify(entry.value)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {status === "done" && (
            <section aria-label="Result" className={boxClass}>
              <h3 className="font-bold">Result</h3>
              <p className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">
                {JSON.stringify(result)}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
