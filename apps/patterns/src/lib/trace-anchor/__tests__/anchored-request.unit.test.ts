import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSpanTree,
  createBatchExporter,
  createTracer,
  type EndedSpan,
} from "@/lib/harness/span-exporter";
import { createStepRunner } from "@/lib/harness/step-runner";
import {
  createAnchorsTable,
  createRequestFunction,
  resumeRequest,
  steppedSpan,
} from "../anchored-request";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(context: "anchor" | "ambient" = "anchor") {
  const exporter = createBatchExporter();
  const tracer = createTracer(exporter);
  const anchors = createAnchorsTable();
  const notifications: string[] = [];
  // The route's root span: its anchor travels in the trigger event as data.
  const { anchor } = await tracer.startRoot("request.received", () => undefined);
  const run = createStepRunner(
    createRequestFunction({
      tracer,
      anchors,
      context,
      timeout: 5000,
      notify: (text) => notifications.push(text),
    }),
    { trigger: { name: "request.received", data: { requestId: "req_1", traceAnchor: anchor } } },
  );
  const spans = () => exporter.getSnapshot().pending;
  const names = (list: EndedSpan[]) => list.map((span) => span.name);
  return { exporter, tracer, anchors, run, anchor, notifications, spans, names };
}

describe("createRequestFunction with the anchor as data", () => {
  it("every step's span nests under the root across the pause, in one trace", async () => {
    const { run, tracer, anchors, anchor, spans, names } = await setup();
    await run.start();
    expect(run.getSnapshot().status).toBe("suspended");
    expect(anchors.rows()).toHaveLength(1);

    await resumeRequest({ tracer, anchors, run, requestId: "req_1", approved: true });

    expect(run.getSnapshot().result).toEqual({ approved: true, url: "/requests/req_1/link" });
    const tree = buildSpanTree(spans());
    expect(tree).toHaveLength(1);
    expect(names(tree[0].children.map((node) => node.span))).toEqual([
      "prepare",
      "request-approval",
      "send-link",
    ]);
    const gate = tree[0].children[1];
    expect(names(gate.children.map((node) => node.span))).toEqual(["decision"]);
    expect(new Set(spans().map((span) => span.traceId))).toEqual(new Set([anchor.traceId]));
  });

  it("a replay re-emits no span", async () => {
    const { run, spans } = await setup();
    await run.start();
    const before = spans().length;
    await run.replay();
    expect(spans().length).toBe(before);
  });

  it("the anchor row is consumed: a duplicate decision becomes its own root and resumes nothing", async () => {
    const { run, tracer, anchors, spans } = await setup();
    await run.start();
    const first = await resumeRequest({ tracer, anchors, run, requestId: "req_1", approved: true });
    const second = await resumeRequest({
      tracer,
      anchors,
      run,
      requestId: "req_1",
      approved: true,
    });

    expect(first).toEqual({ nested: true, resumed: true });
    expect(second).toEqual({ nested: false, resumed: false });
    expect(anchors.rows()).toHaveLength(0);
    const roots = buildSpanTree(spans());
    expect(roots.map((node) => node.span.name)).toEqual(["request.received", "decision"]);
    expect(roots[1].span.attributes["request.id"]).toBe("req_1");
  });

  it("a reusable row keeps nesting late decisions under the finished gate and never goes away", async () => {
    const { run, tracer, anchors, spans } = await setup();
    await run.start();
    const options = {
      tracer,
      anchors,
      run,
      requestId: "req_1",
      approved: true,
      rows: "reusable",
    } as const;
    await resumeRequest(options);
    await resumeRequest(options);

    expect(anchors.rows()).toHaveLength(1);
    const [root] = buildSpanTree(spans());
    const gate = root.children.find((node) => node.span.name === "request-approval");
    expect(gate?.children.map((node) => node.span.name)).toEqual(["decision", "decision"]);
  });

  it("a timeout resumes with no decision and the send step still nests under the root", async () => {
    const { run, spans } = await setup();
    await run.start();
    await vi.advanceTimersByTimeAsync(5000);

    expect(run.getSnapshot().result).toEqual({ approved: false, url: null });
    const [root] = buildSpanTree(spans());
    expect(root.children.map((node) => node.span.name)).toContain("send-link");
  });
});

describe("createRequestFunction on ambient context", () => {
  it("the trace splits: a second root on the replay, the steps after the pause under it", async () => {
    const { run, tracer, anchors, spans } = await setup("ambient");
    await run.start();
    await resumeRequest({ tracer, anchors, run, requestId: "req_1", approved: true });

    const roots = buildSpanTree(spans());
    const requests = roots.filter((node) => node.span.name === "request");
    expect(requests).toHaveLength(2);
    expect(requests[0].children.map((node) => node.span.name)).toEqual([
      "prepare",
      "request-approval",
    ]);
    expect(requests[1].children.map((node) => node.span.name)).toEqual(["send-link"]);
  });
});

describe("steppedSpan", () => {
  it("creates the span inside the step, once", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    const { anchor } = await tracer.startRoot("root", () => undefined);
    const run = createStepRunner(
      ({ step }) => steppedSpan(step, tracer, "work", anchor, (span) => span.anchor.spanId),
      { trigger: { name: "go", data: {} } },
    );
    await run.start();
    await run.replay();

    const work = exporter.getSnapshot().pending.filter((span) => span.name === "work");
    expect(work).toHaveLength(1);
    expect(work[0].parentSpanId).toBe(anchor.spanId);
    expect(run.getSnapshot().result).toBe(work[0].spanId);
  });
});
