import type { DurableFunction, StepTools } from "@/lib/harness/step-runner";

/**
 * The approval gate behind the `approval-gate-wait-for-event` demo, on the
 * harness step runner. Two halves, called one after the other from the
 * durable function, never from inside a step:
 *
 * - `requestApproval` nudges the approver in its own step, then waits for
 *   a decision event matched on the request id, with a bounded timeout. It
 *   answers true or false; a timeout is false, not a throw.
 * - `runSend` is the tool's real work, in its own step, reached only after
 *   a true.
 */

export const DECISION_EVENT = "request.decided";

type Notifier = (text: string) => void;

export type GateResult = { approved: true; url: string } | { approved: false; message: string };

export const NOT_APPROVED: GateResult = {
  approved: false,
  message: "This action was not approved. Do not retry it automatically.",
};

export async function requestApproval(params: {
  step: StepTools;
  requestId: string;
  reason: string;
  timeout: number;
  notify: Notifier;
}): Promise<boolean> {
  const { step, requestId, reason, timeout, notify } = params;

  // Its own step, separate from the wait: a replay must not nudge twice.
  await step.run("notify-approver", () => {
    notify(`Approve "${reason}"? (${requestId})`);
    return true;
  });

  const decision = await step.waitForEvent("wait-for-decision", {
    event: DECISION_EVENT,
    match: "data.requestId",
    timeout,
  });

  if (decision === null) return false;
  return decision.data.approved === true;
}

export async function runSend(step: StepTools, requestId: string): Promise<GateResult> {
  return step.run("send-link", () => ({ approved: true, url: `/requests/${requestId}/link` }));
}

export type GateOptions = {
  timeout: number;
  notify: Notifier;
  /**
   * `"own-step"` is the pattern. `"unstepped"` is the demo's wrong variant:
   * the nudge goes out from plain function code, which a replay re-runs.
   */
  nudge?: "own-step" | "unstepped";
};

/** The durable function: the request half, then the run half only after a yes. */
export function createGatedFunction(options: GateOptions): DurableFunction<GateResult> {
  const { timeout, notify, nudge = "own-step" } = options;

  return async ({ event, step }) => {
    const requestId = String(event.data.requestId);
    const reason = String(event.data.reason);

    let approved: boolean;
    if (nudge === "unstepped") {
      notify(`Approve "${reason}"? (${requestId})`);
      const decision = await step.waitForEvent("wait-for-decision", {
        event: DECISION_EVENT,
        match: "data.requestId",
        timeout,
      });
      approved = decision !== null && decision.data.approved === true;
    } else {
      approved = await requestApproval({ step, requestId, reason, timeout, notify });
    }

    if (!approved) return NOT_APPROVED;
    return runSend(step, requestId);
  };
}
