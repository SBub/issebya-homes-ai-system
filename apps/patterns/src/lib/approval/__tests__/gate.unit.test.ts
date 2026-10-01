import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStepRunner } from "@/lib/harness/step-runner";
import {
  createGatedFunction,
  DECISION_EVENT,
  NOT_APPROVED,
  requestApproval,
  runSend,
} from "../gate";

const trigger = {
  name: "request.received",
  data: { requestId: "req_1", reason: "send the link" },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(nudge: "own-step" | "unstepped" = "own-step") {
  const notifications: string[] = [];
  const fn = createGatedFunction({
    timeout: 5000,
    notify: (text) => notifications.push(text),
    nudge,
  });
  const runner = createStepRunner(fn, { trigger });
  return { runner, notifications };
}

describe("createGatedFunction", () => {
  it("nudges once, suspends, and runs the send half only after approval", async () => {
    const { runner, notifications } = setup();

    await runner.start();

    expect(notifications).toEqual(['Approve "send the link"? (req_1)']);
    expect(runner.getSnapshot().status).toBe("suspended");
    expect(runner.getSnapshot().memo.map((entry) => entry.id)).toEqual(["notify-approver"]);

    await runner.send({ name: DECISION_EVENT, data: { requestId: "req_1", approved: true } });

    expect(runner.getSnapshot().status).toBe("done");
    expect(runner.getSnapshot().result).toEqual({ approved: true, url: "/requests/req_1/link" });
    expect(runner.getSnapshot().memo.map((entry) => entry.id)).toEqual([
      "notify-approver",
      "wait-for-decision",
      "send-link",
    ]);
    expect(notifications).toHaveLength(1);
  });

  it("answers a rejection with the soft result and never reaches the send step", async () => {
    const { runner } = setup();
    await runner.start();

    await runner.send({ name: DECISION_EVENT, data: { requestId: "req_1", approved: false } });

    expect(runner.getSnapshot().result).toEqual(NOT_APPROVED);
    expect(runner.getSnapshot().memo.map((entry) => entry.id)).not.toContain("send-link");
  });

  it("answers a timeout with the same soft result instead of throwing", async () => {
    const { runner } = setup();
    await runner.start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(runner.getSnapshot().status).toBe("done");
    expect(runner.getSnapshot().result).toEqual(NOT_APPROVED);
  });

  it("ignores a decision for another request", async () => {
    const { runner } = setup();
    await runner.start();

    await runner.send({ name: DECISION_EVENT, data: { requestId: "req_9", approved: true } });

    expect(runner.getSnapshot().status).toBe("suspended");
  });

  it("a replay does not nudge again when the nudge has its own step", async () => {
    const { runner, notifications } = setup("own-step");
    await runner.start();

    await runner.replay();

    expect(notifications).toHaveLength(1);
    expect(runner.getSnapshot().status).toBe("suspended");
  });

  it("the unstepped variant nudges again on every replay", async () => {
    const { runner, notifications } = setup("unstepped");
    await runner.start();

    await runner.replay();
    await runner.send({ name: DECISION_EVENT, data: { requestId: "req_1", approved: true } });

    expect(notifications).toHaveLength(3);
    expect(runner.getSnapshot().result).toEqual({ approved: true, url: "/requests/req_1/link" });
  });
});

describe("the two halves on their own", () => {
  it("requestApproval answers true only for an approved decision event", async () => {
    const notify = vi.fn();
    const runner = createStepRunner(
      ({ step }) =>
        requestApproval({ step, requestId: "req_1", reason: "send", timeout: 5000, notify }),
      { trigger },
    );
    await runner.start();
    expect(notify).toHaveBeenCalledWith('Approve "send"? (req_1)');

    await runner.send({ name: DECISION_EVENT, data: { requestId: "req_1", approved: "yes" } });

    // Anything but boolean true is a no.
    expect(runner.getSnapshot().result).toBe(false);
  });

  it("runSend runs in its own step and memoizes the link", async () => {
    const runner = createStepRunner(({ step }) => runSend(step, "req_7"), { trigger });
    await runner.start();
    await runner.replay();
    expect(runner.getSnapshot().result).toEqual({ approved: true, url: "/requests/req_7/link" });
    expect(runner.getSnapshot().memo).toEqual([
      { id: "send-link", value: { approved: true, url: "/requests/req_7/link" } },
    ]);
  });
});
