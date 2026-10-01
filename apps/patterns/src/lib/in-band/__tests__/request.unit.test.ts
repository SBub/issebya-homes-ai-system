import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStepRunner } from "@/lib/harness/step-runner";
import {
  buttonData,
  composeDecision,
  composeQuestion,
  parseButtonData,
  parseRef,
  tagWithRef,
} from "../correlation";
import {
  ANSWER_EVENT,
  createChat,
  createRequestFunction,
  DECISION_EVENT,
  relayUpdate,
  type RequestResult,
} from "../request";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the id in the message", () => {
  it("round-trips through a ref tag at the end of the text", () => {
    const text = tagWithRef("Is late check-in possible?", "req_1");
    expect(text.endsWith("[ref:req_1]")).toBe(true);
    expect(parseRef(text)).toBe("req_1");
    expect(parseRef(`${text}\n`)).toBe("req_1");
  });

  it("finds no id in text without a tag, or with the tag in the middle", () => {
    expect(parseRef("Hello")).toBeNull();
    expect(parseRef("[ref:req_1] then more")).toBeNull();
    expect(parseRef(null)).toBeNull();
    expect(parseRef("")).toBeNull();
  });

  it("round-trips through button data", () => {
    expect(parseButtonData(buttonData("approve", "req_1"))).toEqual({
      action: "approve",
      id: "req_1",
    });
    expect(parseButtonData(buttonData("reject", "a:b"))).toEqual({ action: "reject", id: "a:b" });
    expect(parseButtonData("approve")).toBeNull();
    expect(parseButtonData("open:req_1")).toBeNull();
    expect(parseButtonData("approve:")).toBeNull();
    expect(parseButtonData(null)).toBeNull();
  });

  it("composes a question with the tag and a decision with the id in each button", () => {
    const question = composeQuestion("req_1", "Late check-in?");
    expect(parseRef(question.text)).toBe("req_1");
    expect(question.buttons).toEqual([]);
    const decision = composeDecision("req_1", "Send it?");
    expect(decision.buttons.map((button) => button.data)).toEqual([
      "approve:req_1",
      "reject:req_1",
    ]);
    expect(parseRef(decision.text)).toBeNull();
  });
});

function setup() {
  const chat = createChat();
  const runs: ReturnType<typeof createStepRunner<RequestResult>>[] = [];
  const start = async (id: string, question: string) => {
    const run = createStepRunner(createRequestFunction({ chat, timeout: 5000 }), {
      trigger: { name: "request.received", data: { id, question } },
    });
    runs.push(run);
    await run.start();
    return run;
  };
  return { chat, runs, start };
}

describe("relayUpdate", () => {
  it("a reply resumes the run whose id is in the replied-to message, then a tap resumes it again", async () => {
    const { chat, runs, start } = setup();
    const run = await start("req_1", "Late check-in?");
    expect(run.getSnapshot().status).toBe("suspended");
    expect(chat.getSnapshot()).toHaveLength(1);

    const reply = await relayUpdate(
      { kind: "reply", replyTo: 1, text: "Yes, until 23:00." },
      { chat, runs },
    );
    expect(reply).toMatchObject({ id: "req_1", resumed: true });
    expect(reply.event).toEqual({
      name: "request.answered",
      data: { id: "req_1", answer: "Yes, until 23:00." },
    });
    expect(run.getSnapshot().status).toBe("suspended");
    expect(run.getSnapshot().pendingWait?.event).toBe("request.decided");
    const decision = chat.getSnapshot()[2];
    expect(decision.buttons[0].data).toBe("approve:req_1");

    const tap = await relayUpdate({ kind: "tap", data: decision.buttons[0].data }, { chat, runs });
    expect(tap).toMatchObject({ id: "req_1", resumed: true });
    expect(run.getSnapshot().status).toBe("done");
    expect(run.getSnapshot().result).toEqual({ answer: "Yes, until 23:00.", approved: true });
  });

  it("a second reply to the same message is ignored: nothing waits on that id any more", async () => {
    const { chat, runs, start } = setup();
    const run = await start("req_1", "Late check-in?");
    await relayUpdate({ kind: "reply", replyTo: 1, text: "Yes." }, { chat, runs });
    const second = await relayUpdate(
      { kind: "reply", replyTo: 1, text: "Yes, sorry, no." },
      { chat, runs },
    );

    expect(second).toMatchObject({
      id: "req_1",
      resumed: false,
      note: "no run is waiting on req_1: ignored",
    });
    expect(run.getSnapshot().status).toBe("suspended");
    expect(run.getSnapshot().pendingWait?.event).toBe("request.decided");
  });

  it("a second tap after the run is done is ignored", async () => {
    const { chat, runs, start } = setup();
    const run = await start("req_1", "Late check-in?");
    await relayUpdate({ kind: "reply", replyTo: 1, text: "Yes." }, { chat, runs });
    await relayUpdate({ kind: "tap", data: "approve:req_1" }, { chat, runs });
    const again = await relayUpdate({ kind: "tap", data: "reject:req_1" }, { chat, runs });

    expect(again.resumed).toBe(false);
    expect(run.getSnapshot().result).toEqual({ answer: "Yes.", approved: true });
  });

  it("a reply to a message without a tag, or a tap with no id, sends no event", async () => {
    const { chat, runs, start } = setup();
    await start("req_1", "Late check-in?");
    chat.post({ from: "agent", text: "Just a note.", buttons: [], replyTo: null });

    const reply = await relayUpdate({ kind: "reply", replyTo: 2, text: "Ok" }, { chat, runs });
    expect(reply).toEqual({
      id: null,
      event: null,
      resumed: false,
      note: "no id in the update: ignored",
    });
    const tap = await relayUpdate({ kind: "tap", data: "approve" }, { chat, runs });
    expect(tap.event).toBeNull();
  });

  it("with two requests pending, the id in the message picks the right run; the latest-pending lookup picks the wrong one", async () => {
    const { chat, runs, start } = setup();
    const first = await start("req_1", "Late check-in?");
    const second = await start("req_2", "Parking?");

    const right = await relayUpdate({ kind: "reply", replyTo: 1, text: "Yes." }, { chat, runs });
    expect(right.id).toBe("req_1");
    expect(first.getSnapshot().pendingWait?.event).toBe("request.decided");
    expect(second.getSnapshot().pendingWait?.event).toBe("request.answered");
  });

  it("the latest-pending lookup resumes the wrong run", async () => {
    const { chat, runs, start } = setup();
    const first = await start("req_1", "Late check-in?");
    const second = await start("req_2", "Parking?");

    const wrong = await relayUpdate(
      { kind: "reply", replyTo: 1, text: "Yes." },
      { chat, runs, lookup: "latest" },
    );
    expect(wrong.id).toBe("req_2");
    expect(first.getSnapshot().pendingWait?.event).toBe("request.answered");
    expect(second.getSnapshot().pendingWait?.event).toBe("request.decided");
  });

  it("a timeout on the question ends the run with no answer", async () => {
    const { start } = setup();
    const run = await start("req_1", "Late check-in?");
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.getSnapshot().status).toBe("done");
    expect(run.getSnapshot().result).toEqual({ answer: null, approved: false });
  });
});
