import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSpanTree,
  createBatchExporter,
  createTracer,
  INVALID_ANCHOR,
  isValidSpanId,
  isValidTraceAnchor,
  isValidTraceId,
} from "../span-exporter";

describe("ids", () => {
  it("accepts hex ids of the real lengths and rejects the all-zero sentinel", () => {
    expect(isValidTraceId("a".repeat(32))).toBe(true);
    expect(isValidTraceId("0".repeat(32))).toBe(false);
    expect(isValidTraceId("a".repeat(31))).toBe(false);
    expect(isValidTraceId("g".repeat(32))).toBe(false);
    expect(isValidSpanId("b".repeat(16))).toBe(true);
    expect(isValidSpanId("0".repeat(16))).toBe(false);
    expect(isValidTraceAnchor(INVALID_ANCHOR)).toBe(false);
  });

  it("a recording tracer hands out valid random ids, a non-recording one the sentinel", async () => {
    const recording = createTracer(createBatchExporter());
    const { anchor } = await recording.startRoot("root", () => 1);
    expect(isValidTraceAnchor(anchor)).toBe(true);

    const silent = createTracer(null);
    const { anchor: zero } = await silent.startRoot("root", () => 1);
    expect(zero).toEqual(INVALID_ANCHOR);
  });
});

describe("createTracer", () => {
  it("nests a child under an explicit anchor and shares its trace id", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    const { anchor } = await tracer.startRoot("root", () => undefined);
    await tracer.withSpan("child", { parent: anchor }, () => undefined);

    const [root, child] = exporter.getSnapshot().pending;
    expect(root.parentSpanId).toBeNull();
    expect(child.parentSpanId).toBe(anchor.spanId);
    expect(child.traceId).toBe(anchor.traceId);
  });

  it("nests under the ambient active span inside withSpan and starts a root outside", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    expect(tracer.activeAnchor()).toBeNull();

    await tracer.withSpan("outer", {}, async (outer) => {
      expect(tracer.activeAnchor()).toEqual(outer.anchor);
      await tracer.withSpan("inner", {}, () => undefined);
    });
    await tracer.withSpan("later", {}, () => undefined);

    const byName = Object.fromEntries(exporter.getSnapshot().pending.map((s) => [s.name, s]));
    expect(byName.inner.parentSpanId).toBe(byName.outer.spanId);
    expect(byName.later.parentSpanId).toBeNull();
    expect(byName.later.traceId).not.toBe(byName.outer.traceId);
  });

  it("parent null forces a root even inside an active span", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    await tracer.withSpan("outer", {}, async () => {
      await tracer.withSpan("detached", { parent: null }, () => undefined);
    });
    const detached = exporter.getSnapshot().pending.find((s) => s.name === "detached");
    expect(detached?.parentSpanId).toBeNull();
  });

  it("marks a span failed on a throw and still ends it", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    await expect(
      tracer.withSpan("boom", {}, () => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    const [span] = exporter.getSnapshot().pending;
    expect(span.status).toBe("error");
    expect(span.error).toBe("no");
  });

  it("records attributes and a soft failure", () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    const span = tracer.startSpan("work", { attributes: { "request.id": "r1" } });
    span.setAttribute("rows", 2);
    span.fail("send failed");
    span.end();
    span.end();
    const [ended] = exporter.getSnapshot().pending;
    expect(exporter.getSnapshot().pending).toHaveLength(1);
    expect(ended.attributes).toEqual({ "request.id": "r1", rows: 2 });
    expect(ended.status).toBe("error");
  });

  it("a non-recording tracer never enqueues", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(null);
    await tracer.withSpan("ghost", {}, () => undefined);
    expect(exporter.getSnapshot().pending).toHaveLength(0);
  });
});

describe("createBatchExporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues ended spans and exports them only on flush", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    await tracer.withSpan("a", {}, () => undefined);
    expect(exporter.getSnapshot().exported).toHaveLength(0);

    await exporter.flush();
    const snapshot = exporter.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.exported.map((s) => s.name)).toEqual(["a"]);
    expect(snapshot.flushes).toBe(1);
  });

  it("a flush with nothing pending is not counted", async () => {
    const exporter = createBatchExporter();
    await exporter.flush();
    expect(exporter.getSnapshot().flushes).toBe(0);
  });

  it("takes the delay before the batch lands", async () => {
    const exporter = createBatchExporter({ delay: 300 });
    const tracer = createTracer(exporter);
    await tracer.withSpan("a", {}, () => undefined);
    const flushing = exporter.flush();
    expect(exporter.getSnapshot().pending).toHaveLength(0);
    expect(exporter.getSnapshot().exported).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    await flushing;
    expect(exporter.getSnapshot().exported).toHaveLength(1);
  });

  it("freeze drops the queue", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    await tracer.withSpan("a", {}, () => undefined);
    exporter.freeze();
    const snapshot = exporter.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.dropped.map((s) => s.name)).toEqual(["a"]);
    expect(snapshot.exported).toHaveLength(0);
  });

  it("notifies subscribers and clears", async () => {
    const exporter = createBatchExporter();
    const listener = vi.fn();
    const unsubscribe = exporter.subscribe(listener);
    createTracer(exporter).startSpan("a").end();
    expect(listener).toHaveBeenCalledTimes(1);
    exporter.clear();
    expect(exporter.getSnapshot()).toEqual({ pending: [], exported: [], dropped: [], flushes: 0 });
    unsubscribe();
    exporter.freeze();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("buildSpanTree", () => {
  it("nests by parent id and treats a span with an unknown parent as a root", async () => {
    const exporter = createBatchExporter();
    const tracer = createTracer(exporter);
    const { anchor } = await tracer.startRoot("root", async () => undefined);
    await tracer.withSpan("child", { parent: anchor }, async () => {
      await tracer.withSpan("grandchild", {}, () => undefined);
    });
    await tracer.withSpan(
      "orphan",
      { parent: { traceId: anchor.traceId, spanId: "f".repeat(16) } },
      () => undefined,
    );

    const tree = buildSpanTree(exporter.getSnapshot().pending);
    expect(tree.map((node) => node.span.name)).toEqual(["root", "orphan"]);
    expect(tree[0].children.map((node) => node.span.name)).toEqual(["child"]);
    expect(tree[0].children[0].children.map((node) => node.span.name)).toEqual(["grandchild"]);
  });
});
