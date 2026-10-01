import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpanTree, createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import { createChat } from "@/lib/in-band/request";
import { createAnchorsTable } from "@/lib/trace-anchor/anchored-request";
import { createStepRunner } from "@/lib/harness/step-runner";
import {
  computeSendLink,
  DECISION_EVENT,
  NOT_APPROVED,
  receiveToolCall,
  relayTap,
  requestSendLinkApproval,
  runSendLink,
  sendLink,
  type TurnDeps,
  verifySendLink,
} from "../gated-tool";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const TODAY = "2026-10-01";
const FREE = { from: "2026-10-06", to: "2026-10-08", email: "ana@example.com" };

function setup() {
  const exporter = createBatchExporter();
  const deps: TurnDeps = {
    tracer: createTracer(exporter),
    anchors: createAnchorsTable(),
    chat: createChat(),
    timeout: 5000,
    today: TODAY,
  };
  const receive = (input: Record<string, unknown>, correlationId = "corr_1") =>
    receiveToolCall(deps, { correlationId, input });
  const names = () => {
    const [root] = buildSpanTree(exporter.getSnapshot().pending);
    const flatten = (node: typeof root, depth: number): string[] => [
      `${"  ".repeat(depth)}${node.span.name}`,
      ...node.children.flatMap((child) => flatten(child, depth + 1)),
    ];
    return buildSpanTree(exporter.getSnapshot().pending).flatMap((node) => flatten(node, 0));
  };
  return { deps, exporter, receive, names };
}

describe("the tool file", () => {
  it("hands the model a schema and a description and nothing that runs", () => {
    expect(sendLink).not.toHaveProperty("execute");
    expect(sendLink.inputSchema.safeParse(FREE).success).toBe(true);
    expect(sendLink.inputSchema.safeParse({ from: "2026-10-06" }).success).toBe(false);
    expect(DECISION_EVENT).toBe("link.decided");
  });

  it("the two halves each refuse input the schema rejects with the single-key error object", async () => {
    const { deps } = setup();
    const { anchor } = await deps.tracer.startRoot("message.received", () => undefined);
    const run = createStepRunner(
      async ({ step }) => {
        const context = { ...deps, step, traceAnchor: anchor, correlationId: "corr_x" };
        const request = await requestSendLinkApproval({ from: 1 }, context);
        const output = await runSendLink({ from: 1 }, context);
        return { request, output };
      },
      { trigger: { name: "message.received", data: {} } },
    );
    await run.start();
    expect(run.getSnapshot().result).toMatchObject({
      request: {
        approved: false,
        output: { error: expect.stringContaining("Invalid input for send_link") },
      },
      output: { error: expect.stringContaining("Invalid input for send_link") },
    });
    expect(deps.chat.getSnapshot()).toEqual([]);
  });
});

describe("the pure halves", () => {
  it("computeSendLink builds the URL from its arguments", () => {
    expect(computeSendLink(FREE)).toEqual({
      url: "/book?from=2026-10-06&to=2026-10-08&email=ana%40example.com",
    });
  });

  it("verifySendLink refuses the ranges check_dates refuses, and a booked one", () => {
    expect(verifySendLink(FREE, TODAY)).toBeNull();
    expect(verifySendLink({ ...FREE, from: "2026-09-20", to: "2026-09-22" }, TODAY)).toMatchObject({
      approved: false,
      reason: "past_date",
    });
    expect(verifySendLink({ ...FREE, from: "2026-10-10", to: "2026-10-12" }, TODAY)).toMatchObject({
      reason: "not_available",
    });
  });
});

describe("a gated tool call", () => {
  it("re-checks, records the anchor, nudges with the id in the button data, and pauses", async () => {
    const { deps, receive, names } = setup();
    const turn = await receive(FREE);

    expect(turn.run.getSnapshot().status).toBe("suspended");
    expect(turn.run.getSnapshot().pendingWait).toMatchObject({
      event: "link.decided",
      match: "data.correlationId",
      value: "corr_1",
    });
    expect(deps.anchors.rows().map((row) => row.requestId)).toEqual(["corr_1"]);
    const [nudge] = deps.chat.getSnapshot();
    expect(nudge.text).toContain("Send the link for 2026-10-06 to 2026-10-08 to ana@example.com?");
    expect(nudge.buttons.map((button) => button.data)).toEqual(["approve:corr_1", "reject:corr_1"]);
    expect(names()).toEqual(["message.received", "  gate-send_link", "    nudge-approver"]);
  });

  it("a tap resumes it: the decision nests under the gate, the run half runs, the model gets the URL", async () => {
    const { deps, receive, names } = setup();
    const turn = await receive(FREE);
    const relay = await relayTap(deps, [turn], "approve:corr_1");

    expect(relay).toEqual({ id: "corr_1", approved: true, nested: true, resumed: true });
    expect(turn.run.getSnapshot().status).toBe("done");
    expect(turn.run.getSnapshot().result).toEqual({
      approved: true,
      output: { url: "/book?from=2026-10-06&to=2026-10-08&email=ana%40example.com" },
    });
    expect(names()).toEqual([
      "message.received",
      "  gate-send_link",
      "    nudge-approver",
      "    decision",
      "    gate-decision",
      "  tool-send_link",
    ]);
    expect(turn.run.getSnapshot().memo.map((entry) => entry.id)).toEqual([
      "gate-send_link",
      "verify-send_link",
      "record-gate-anchor",
      "nudge-approver",
      "wait-for-decision",
      "gate-decision",
      "tool-send_link",
    ]);
  });

  it("a rejection gives the model the not-approved object and the run half never runs", async () => {
    const { deps, receive } = setup();
    const turn = await receive(FREE);
    await relayTap(deps, [turn], "reject:corr_1");

    expect(turn.run.getSnapshot().result).toEqual({ approved: false, output: NOT_APPROVED });
    expect(turn.run.getSnapshot().memo.map((entry) => entry.id)).not.toContain("tool-send_link");
  });

  it("a timeout is a no as well", async () => {
    const { receive } = setup();
    const turn = await receive(FREE);
    await vi.advanceTimersByTimeAsync(5000);
    expect(turn.run.getSnapshot().result).toEqual({ approved: false, output: NOT_APPROVED });
  });

  it("a range that fails the re-check is refused before anyone is nudged", async () => {
    const { deps, receive, names } = setup();
    const turn = await receive({ ...FREE, from: "2026-09-20", to: "2026-09-22" });

    expect(turn.run.getSnapshot().status).toBe("done");
    expect(turn.run.getSnapshot().result).toMatchObject({
      approved: false,
      output: { approved: false, reason: "past_date" },
    });
    expect(deps.chat.getSnapshot()).toEqual([]);
    expect(deps.anchors.rows()).toEqual([]);
    expect(names()).toEqual(["message.received", "  gate-send_link"]);
  });

  it("a second tap finds no anchor row and no waiting run", async () => {
    const { deps, receive, names } = setup();
    const turn = await receive(FREE);
    await relayTap(deps, [turn], "approve:corr_1");
    const again = await relayTap(deps, [turn], "reject:corr_1");

    expect(again).toEqual({ id: "corr_1", approved: false, nested: false, resumed: false });
    expect(turn.run.getSnapshot().result).toMatchObject({ approved: true });
    expect(names().filter((line) => !line.startsWith(" "))).toEqual([
      "message.received",
      "decision",
    ]);
  });

  it("a replay repeats nothing", async () => {
    const { deps, exporter, receive } = setup();
    const turn = await receive(FREE);
    await relayTap(deps, [turn], "approve:corr_1");
    const spans = exporter.getSnapshot().pending.length;
    await turn.run.replay();
    expect(exporter.getSnapshot().pending.length).toBe(spans);
    expect(deps.chat.getSnapshot()).toHaveLength(1);
  });
});
