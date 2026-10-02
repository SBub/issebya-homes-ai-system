import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStepRunner, type DurableFunction, type LogEntry } from "../step-runner";

const trigger = { name: "request.received", data: { id: "req_1" } };

const stepLog = (log: LogEntry[]) =>
  log
    .filter((entry) => entry.kind === "step" || entry.kind === "wait")
    .map((entry) => `${entry.id}:${entry.outcome}`);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("step.run", () => {
  it("runs a step once and memoizes its result across a replay", async () => {
    const work = vi.fn(async () => 42);
    const runner = createStepRunner(async ({ step }) => step.run("compute", work), { trigger });

    await runner.start();
    await runner.replay();

    expect(work).toHaveBeenCalledTimes(1);
    expect(runner.getSnapshot().status).toBe("done");
    expect(runner.getSnapshot().result).toBe(42);
    expect(runner.getSnapshot().memo).toEqual([{ id: "compute", value: 42 }]);
    expect(stepLog(runner.getSnapshot().log)).toEqual(["compute:ran", "compute:memoized"]);
  });

  it("re-runs code outside a step on every invocation", async () => {
    let bodyRuns = 0;
    const runner = createStepRunner(
      async ({ step }) => {
        bodyRuns += 1;
        await step.run("a", () => "a");
        return bodyRuns;
      },
      { trigger },
    );

    await runner.start();
    await runner.replay();
    await runner.replay();

    expect(bodyRuns).toBe(3);
    expect(runner.getSnapshot().invocations).toBe(3);
  });

  it("refuses a step tool called inside another step's callback", async () => {
    const runner = createStepRunner(
      async ({ step }) => step.run("outer", () => step.run("inner", () => 1)),
      { trigger },
    );

    await runner.start();

    expect(runner.getSnapshot().status).toBe("failed");
    expect(runner.getSnapshot().error).toBe(
      'step "inner" was called inside step "outer": a step callback must not call step tools',
    );
    expect(runner.getSnapshot().memo).toEqual([]);
  });

  it("records a thrown error and fails the run", async () => {
    const runner = createStepRunner(
      async ({ step }) =>
        step.run("boom", () => {
          throw new Error("no");
        }),
      { trigger },
    );
    await runner.start();
    expect(runner.getSnapshot().status).toBe("failed");
    expect(runner.getSnapshot().log.at(-1)).toEqual({ kind: "failed", error: "no" });
  });
});

describe("step.waitForEvent", () => {
  const gated: DurableFunction<string> = async ({ event, step }) => {
    await step.run("notify", () => `asked about ${event.data.id}`);
    const decision = await step.waitForEvent("decision", {
      event: "request.decided",
      match: "data.id",
      timeout: 1000,
    });
    if (decision === null) return "timed out";
    return decision.data.approved ? "sent" : "declined";
  };

  it("suspends the function until a matching event arrives, then replays from the top", async () => {
    const runner = createStepRunner(gated, { trigger });

    await runner.start();
    expect(runner.getSnapshot().status).toBe("suspended");
    expect(runner.getSnapshot().pendingWait).toEqual({
      id: "decision",
      event: "request.decided",
      match: "data.id",
      value: "req_1",
    });

    const resumed = await runner.send({
      name: "request.decided",
      data: { id: "req_1", approved: true },
    });

    expect(resumed).toBe(true);
    expect(runner.getSnapshot().status).toBe("done");
    expect(runner.getSnapshot().result).toBe("sent");
    expect(runner.getSnapshot().invocations).toBe(2);
    expect(stepLog(runner.getSnapshot().log)).toEqual([
      "notify:ran",
      "decision:suspended",
      "notify:memoized",
      "decision:memoized",
    ]);
  });

  it("ignores an event with another name or another correlation value", async () => {
    const runner = createStepRunner(gated, { trigger });
    await runner.start();

    expect(await runner.send({ name: "request.decided", data: { id: "req_2" } })).toBe(false);
    expect(await runner.send({ name: "other.event", data: { id: "req_1" } })).toBe(false);
    expect(runner.getSnapshot().status).toBe("suspended");
    expect(runner.getSnapshot().log.filter((entry) => entry.kind === "event")).toEqual([
      { kind: "event", name: "request.decided", outcome: "ignored" },
      { kind: "event", name: "other.event", outcome: "ignored" },
    ]);
  });

  it("resumes with null when the timeout elapses first", async () => {
    const runner = createStepRunner(gated, { trigger });
    await runner.start();

    await vi.advanceTimersByTimeAsync(1000);

    expect(runner.getSnapshot().status).toBe("done");
    expect(runner.getSnapshot().result).toBe("timed out");
    expect(runner.getSnapshot().memo).toContainEqual({ id: "decision", value: null });
    expect(runner.getSnapshot().log).toContainEqual({ kind: "timeout", id: "decision" });
  });

  it("a replay while suspended skips the memoized steps and suspends again", async () => {
    const runner = createStepRunner(gated, { trigger });
    await runner.start();

    await runner.replay();

    expect(runner.getSnapshot().status).toBe("suspended");
    expect(stepLog(runner.getSnapshot().log)).toEqual([
      "notify:ran",
      "decision:suspended",
      "notify:memoized",
      "decision:suspended",
    ]);
    // Still one pending wait, and the event still resumes it.
    expect(
      await runner.send({ name: "request.decided", data: { id: "req_1", approved: false } }),
    ).toBe(true);
    expect(runner.getSnapshot().result).toBe("declined");
  });

  it("a late event after the timeout is ignored", async () => {
    const runner = createStepRunner(gated, { trigger });
    await runner.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      await runner.send({ name: "request.decided", data: { id: "req_1", approved: true } }),
    ).toBe(false);
    expect(runner.getSnapshot().result).toBe("timed out");
  });
});

describe("lifecycle", () => {
  it("start only works from idle and replay only after a start", async () => {
    const work = vi.fn(() => 1);
    const runner = createStepRunner(async ({ step }) => step.run("a", work), { trigger });

    await runner.replay();
    expect(runner.getSnapshot().invocations).toBe(0);

    await runner.start();
    await runner.start();
    expect(runner.getSnapshot().invocations).toBe(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("reset clears the memo, the log and a pending timer", async () => {
    const runner = createStepRunner(
      async ({ step }) => step.waitForEvent("w", { event: "e", match: "data.id", timeout: 1000 }),
      { trigger },
    );
    await runner.start();
    runner.reset();

    expect(runner.getSnapshot()).toEqual({
      status: "idle",
      invocations: 0,
      log: [],
      memo: [],
      pendingWait: null,
      result: undefined,
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.getSnapshot().status).toBe("idle");
  });

  it("notifies subscribers on every change with a fresh snapshot object", async () => {
    const runner = createStepRunner(async ({ step }) => step.run("a", () => 1), { trigger });
    const seen: unknown[] = [];
    const unsubscribe = runner.subscribe(() => seen.push(runner.getSnapshot()));
    const before = runner.getSnapshot();

    await runner.start();

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(seen.length);
    expect(runner.getSnapshot()).not.toBe(before);
    unsubscribe();
  });
});
