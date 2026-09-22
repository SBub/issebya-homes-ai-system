import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { GetStepTools } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { inngest } from "@/lib/inngest";

// Same in-memory OTel wiring as run-turn.test.ts/approval-gate.test.ts, so
// span assertions below inspect a real span's attributes instead of a no-op.
const spanExporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
);

// wants-human.ts's runWantsHuman is a deliberate exception to the "tool
// files stay pure" rule (see run-tool.ts's comment near `tools` and this
// app's CLAUDE.md) — it owns real step/span dispatch, same posture
// approval-gate.test.ts already tests requestApprovalGate with. Mocks every
// real external boundary: telegram-router (the owner nudge send) and
// tracing.ts's updateSpanIO (a real fetch() to Braintrust's REST API).
const sendOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendOwnerNudge: sendOwnerNudgeMock,
}));

const updateSpanIOMock = vi.fn();
vi.mock("@/lib/tracing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tracing.js")>();
  return { ...actual, updateSpanIO: updateSpanIOMock };
});

const { runWantsHuman } = await import("@/agent/tools/wants-human.js");

const TEST_TRACE_ANCHOR = { traceId: "0".repeat(32), spanId: "0".repeat(16) };

type StepTools = GetStepTools<typeof inngest>;

// Only `run` is exercised by real code here — see approval-gate.test.ts's
// own makeStepMock comment for why the rest of the real StepTools surface is
// cast away rather than stubbed out.
function makeStepMock() {
  return {
    run: vi.fn((_id: string, fn: () => unknown) => Promise.resolve(fn())),
  } as unknown as StepTools & { run: ReturnType<typeof vi.fn> };
}

describe("runWantsHuman", () => {
  let step: ReturnType<typeof makeStepMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spanExporter.reset();
    step = makeStepMock();
    sendOwnerNudgeMock.mockResolvedValue({ ok: true });
  });

  it("sends the owner nudge with the model's reason under reasonCategory 'wants_human'", async () => {
    await runWantsHuman(
      { reason: "Guest wants a human" },
      {
        conversationId: "convo-1",
        phone: "+3519",
        traceAnchor: TEST_TRACE_ANCHOR,
        step,
      },
    );

    expect(sendOwnerNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-1",
        phone: "+3519",
        reason: "Guest wants a human",
        reasonCategory: "wants_human",
      }),
    );
  });

  it("returns the notified message when the nudge succeeded", async () => {
    await expect(
      runWantsHuman(
        { reason: "Guest wants a human" },
        { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
      ),
    ).resolves.toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
  });

  it("returns the honest fallback message when the nudge failed to send", async () => {
    sendOwnerNudgeMock.mockResolvedValue({ ok: false, error: "telegram-router down" });

    await expect(
      runWantsHuman(
        { reason: "Guest wants a human" },
        { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
      ),
    ).resolves.toEqual({
      escalated: true,
      message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
    });
  });

  it("creates the gen_ai.tool.wants_human execution span first, with the model's input, nested under the nudge span", async () => {
    await runWantsHuman(
      { reason: "Guest wants a human" },
      { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    expect(step.run.mock.calls.map((call) => call[0])).toEqual([
      "tool-wants_human",
      "owner-nudge-wants-human",
      "update-wants-human-trace-io",
    ]);

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.wants_human");
    expect(execSpan?.attributes["gen_ai.tool.name"]).toBe("wants_human");
    expect(execSpan?.attributes["gca.tool.input"]).toBe(
      JSON.stringify({ reason: "Guest wants a human" }),
    );
    // output isn't known until after the nudge send, well after this span
    // has already closed, so it's patched in retroactively via updateSpanIO
    // instead — never set directly as a span attribute.
    expect(execSpan?.attributes["gca.tool.output"]).toBeUndefined();

    // Literal parent/child span linkage can't be asserted in this vitest
    // environment — no real AsyncLocalStorage-based ContextManager is
    // registered here (see run-turn.test.ts's identical comment on its
    // send_booking_link reparenting test for the full reasoning). The
    // step.run call order above (tool span's own step runs first) plus this
    // span existing at all is the strongest same-harness proof available.
    const nudgeSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "owner_nudge.wants_human");
    expect(nudgeSpan?.attributes["braintrust.tags"]).toEqual(["wants_human"]);
  });

  it("retroactively patches the execution span's output via updateSpanIO once the result is known", async () => {
    const result = await runWantsHuman(
      { reason: "Guest wants a human" },
      { conversationId: "convo-1", phone: "+3519", traceAnchor: TEST_TRACE_ANCHOR, step },
    );

    const execSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === "gen_ai.tool.wants_human");
    expect(updateSpanIOMock).toHaveBeenCalledWith(execSpan?.spanContext().spanId, {
      output: result,
    });
  });
});
