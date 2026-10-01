import { describe, expect, it } from "vitest";
import { createStepRunner } from "@/lib/harness/step-runner";
import { createTurnFunction, type TurnMode } from "../turn";

const trigger = { name: "message.received", data: { text: "Is the 6th to the 8th free?" } };

function setup(mode: TurnMode = "stepped") {
  const effects: string[] = [];
  const runner = createStepRunner(
    createTurnFunction({ mode, record: (effect) => effects.push(effect) }),
    { trigger },
  );
  return { runner, effects };
}

const count = (effects: string[], prefix: string) =>
  effects.filter((effect) => effect.startsWith(prefix)).length;

describe("createTurnFunction", () => {
  it("runs each side effect once in its own step and ends with the text reply", async () => {
    const { runner, effects } = setup();
    await runner.start();

    const snapshot = runner.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.result).toEqual({ text: "The 6th to the 8th is free.", rounds: 2 });
    expect(snapshot.memo.map((entry) => entry.id)).toEqual([
      "load-prompt",
      "model-1",
      "tools-1",
      "model-2",
      "send-reply",
    ]);
    expect(count(effects, "fetch prompt")).toBe(1);
    expect(count(effects, "call model")).toBe(2);
    expect(count(effects, "run tool")).toBe(1);
    expect(count(effects, "send reply")).toBe(1);
  });

  it("a replay answers every step from the memo and repeats no side effect", async () => {
    const { runner, effects } = setup();
    await runner.start();
    await runner.replay();

    expect(effects).toHaveLength(5);
    const replayed = runner
      .getSnapshot()
      .log.filter((entry) => entry.kind === "step")
      .slice(5);
    expect(replayed.every((entry) => entry.kind === "step" && entry.outcome === "memoized")).toBe(
      true,
    );
    expect(replayed).toHaveLength(5);
  });

  it("the unstepped send goes out again on a replay", async () => {
    const { runner, effects } = setup("send-unstepped");
    await runner.start();
    await runner.replay();

    expect(count(effects, "send reply")).toBe(2);
    expect(runner.getSnapshot().memo.map((entry) => entry.id)).not.toContain("send-reply");
  });

  it("the prompt fetched inside the loop is fetched again per finished round on a replay", async () => {
    const { runner, effects } = setup("prompt-in-loop");
    await runner.start();
    expect(count(effects, "fetch prompt")).toBe(2);

    await runner.replay();
    expect(count(effects, "fetch prompt")).toBe(4);
    expect(count(effects, "call model")).toBe(2);
  });

  it("a step inside a step is refused and fails the run", async () => {
    const { runner, effects } = setup("nested");
    await runner.start();

    const snapshot = runner.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.error).toContain('step "send-reply" was called inside step "model-2"');
    expect(count(effects, "send reply")).toBe(0);
  });
});
