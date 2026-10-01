import { describe, expect, it } from "vitest";
import { createBatchExporter, createTracer } from "@/lib/harness/span-exporter";
import { type FlushMode, handleRequest } from "../handle-request";

function setup(flush: FlushMode, delay = 0) {
  const exporter = createBatchExporter({ delay });
  const tracer = createTracer(exporter);
  // A clock that advances by 100 ms per reading, so the response time is deterministic.
  let tick = 0;
  const now = () => (tick += 100);
  return { exporter, run: () => handleRequest({ tracer, exporter, flush, now }) };
}

describe("handleRequest", () => {
  it("with no flush the freeze drops every span", async () => {
    const { run, exporter } = setup("none");
    const outcome = await run();

    expect(outcome).toMatchObject({ status: 200, exported: 0, dropped: 3 });
    expect(exporter.getSnapshot().dropped.map((span) => span.name)).toEqual([
      "load-item",
      "render",
      "handle-request",
    ]);
  });

  it("a flush in after() exports every span after the response and before the freeze", async () => {
    const { run, exporter } = setup("after");
    const outcome = await run();

    expect(outcome).toMatchObject({ status: 200, exported: 3, dropped: 0, responseMs: 100 });
    expect(exporter.getSnapshot().flushes).toBe(1);
  });

  it("a flush before the response exports too, with the round trip added to the response", async () => {
    const { run } = setup("before-response", 50);
    const outcome = await run();

    expect(outcome).toMatchObject({ status: 200, exported: 3, dropped: 0 });
    expect(outcome.responseMs).toBe(100);
  });

  it("the spans nest: load-item and render under handle-request", async () => {
    const { run, exporter } = setup("after");
    await run();
    const byName = Object.fromEntries(exporter.getSnapshot().exported.map((s) => [s.name, s]));
    expect(byName["load-item"].parentSpanId).toBe(byName["handle-request"].spanId);
    expect(byName.render.parentSpanId).toBe(byName["handle-request"].spanId);
    expect(byName["handle-request"].parentSpanId).toBeNull();
  });
});
