import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpanTree, createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import { createMessagesTable, recordReply } from "@/lib/idempotent-write/record-reply";
import { createAnchorsTable } from "@/lib/trace-anchor/anchored-request";
import { decideTurn, MESSAGE_EVENT, receiveMessage, type TurnDeps } from "../turn";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const exporter = createBatchExporter();
  const notifications: string[] = [];
  const deps: TurnDeps = {
    tracer: createTracer(exporter),
    exporter,
    messages: createMessagesTable(),
    anchors: createAnchorsTable(),
    notify: (text) => notifications.push(text),
    timeout: 5000,
  };
  const receive = () =>
    receiveMessage(deps, {
      conversationId: "c1",
      text: "Is the 6th to the 8th free? Send me the link.",
      correlationId: "corr_1",
    });
  return { deps, exporter, notifications, receive };
}

describe("a durable turn", () => {
  it("runs to the gate, pauses, and resumes to one recorded, sent reply", async () => {
    const { deps, notifications, receive } = setup();
    const turn = await receive();

    expect(turn.run.getSnapshot().status).toBe("suspended");
    expect(turn.run.getSnapshot().pendingWait?.event).toBe("request.decided");
    expect(notifications).toEqual(["Approve sending the link? (corr_1)"]);
    expect(deps.messages.rows()).toHaveLength(1);

    const { nested, resumed } = await decideTurn(deps, turn, true);
    expect(nested).toBe(true);
    expect(resumed).toBe(true);

    const snapshot = turn.run.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.result).toEqual({
      replyText: "The 6th to the 8th is free. The link is on its way.",
      replyRowId: 2,
      rounds: 3,
    });
    expect(deps.messages.rows().map((row) => [row.role, row.traceId])).toEqual([
      ["user", null],
      ["assistant", turn.anchor.traceId],
    ]);
    expect(notifications.at(-1)).toContain("Reply to c1:");
    expect(turn.run.getSnapshot().memo.map((entry) => entry.id)).toEqual([
      "turn",
      "load-history",
      "model-1",
      "tool-call_1",
      "model-2",
      "notify-approver",
      "wait-for-decision",
      "send-link",
      "model-3",
      "record-reply",
      "send-reply",
    ]);
  });

  it("every span of the turn nests under the ingress root, including the decision", async () => {
    const { deps, exporter, receive } = setup();
    const turn = await receive();
    await decideTurn(deps, turn, true);
    await exporter.flush();

    const roots = buildSpanTree(exporter.getSnapshot().exported);
    expect(roots.map((node) => node.span.name)).toEqual(["message.received"]);
    const [root] = roots;
    expect(root.children.map((node) => node.span.name)).toEqual(["record-inbound", "turn"]);
    const inner = root.children[1].children.map((node) => node.span.name);
    expect(inner).toEqual([
      "load-history",
      "model-1",
      "tool-call_1",
      "model-2",
      "notify-approver",
      "send-link",
      "model-3",
      "record-reply",
      "send-reply",
    ]);
    const gate = root.children[1].children.find((node) => node.span.name === "notify-approver");
    expect(gate?.children.map((node) => node.span.name)).toEqual(["decision"]);
  });

  it("a replay repeats nothing: no new span, no new row, no new notification", async () => {
    const { deps, exporter, notifications, receive } = setup();
    const turn = await receive();
    await decideTurn(deps, turn, true);
    const spans = exporter.getSnapshot().pending.length;

    await turn.run.replay();

    expect(exporter.getSnapshot().pending.length).toBe(spans);
    expect(deps.messages.rows()).toHaveLength(2);
    expect(notifications).toHaveLength(2);
  });

  it("a retried reply write for the same trace returns the existing row", async () => {
    const { deps, receive } = setup();
    const turn = await receive();
    await decideTurn(deps, turn, true);

    const retry = recordReply(deps.messages, {
      conversationId: "c1",
      content: "The 6th to the 8th is free. The link is on its way.",
      traceId: turn.anchor.traceId,
    });
    expect(retry).toEqual({ id: 2, outcome: "existing", warning: null });
    expect(deps.messages.rows()).toHaveLength(2);
  });

  it("a rejection gives the model the not-approved result and the turn still replies", async () => {
    const { deps, receive } = setup();
    const turn = await receive();
    await decideTurn(deps, turn, false);

    const snapshot = turn.run.getSnapshot();
    expect(snapshot.status).toBe("done");
    expect(snapshot.memo.map((entry) => entry.id)).not.toContain("send-link");
    expect(snapshot.result).toMatchObject({ rounds: 3 });
  });

  it("the trigger event carries the anchor and correlation id as data", async () => {
    const { receive } = setup();
    const turn = await receive();
    expect(turn.run.getSnapshot().pendingWait?.value).toBe("corr_1");
    expect(MESSAGE_EVENT).toBe("message.received");
    expect(turn.anchor.traceId).toHaveLength(32);
  });
});
