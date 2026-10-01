import { z } from "zod";
import type { Span, TraceAnchor, Tracer } from "@/lib/harness/span-exporter";
import {
  createStepRunner,
  type DurableFunction,
  type DurableRun,
  type StepTools,
} from "@/lib/harness/step-runner";
import { composeDecision, parseButtonData } from "@/lib/in-band/correlation";
import type { Chat } from "@/lib/in-band/request";
import { type AnchorsTable, steppedSpan } from "@/lib/trace-anchor/anchored-request";
import { computeCheckDates, invalidInput } from "@/lib/tool-files/check-dates";
import { dispatchToolExecution } from "@/lib/tool-files/tool-execution";

/**
 * The composite behind the `human-gated-tool` demo: one gated tool, from
 * the model's call to the result the model reads, on the harness runtime.
 * It is the shape of GCA's booking.ts with approval-gate.ts and the
 * Telegram relay:
 *
 * - The tool file holds the schema, a pure compute, a request half and a
 *   run half (tool-file-convention). The request half opens the gate span,
 *   re-verifies the model's arguments in a step, and only then asks.
 * - The gate records the gate span's anchor under the correlation id,
 *   nudges the approver in its own step, and waits for the decision event
 *   matched on that id with a bounded timeout (approval-gate-wait-for-event,
 *   trace-anchor-across-steps).
 * - The nudge carries the id in each button's data; the relay parses it
 *   back out and sends the event as it came (in-band-correlation).
 * - The run half executes only after a yes, in its own stepped span. A no,
 *   a timeout and a refusal all come back as objects the model can read.
 */

export const DECISION_EVENT = "link.decided";

export const NOT_APPROVED = {
  approved: false,
  message: "This action was not approved. Do not retry it automatically.",
};

const sendLinkSchema = z.object({
  from: z.string().describe("Check-in date, YYYY-MM-DD"),
  to: z.string().describe("Check-out date, YYYY-MM-DD"),
  email: z.string().describe("Where the link goes"),
});

/** Schema only: the loop decides whether and when the run half runs. */
export const sendLink = {
  description: "Send the booking link. Call it once the person has confirmed the dates.",
  inputSchema: sendLinkSchema,
};

type SendLinkInput = z.infer<typeof sendLinkSchema>;

type GatedContext = {
  step: StepTools;
  tracer: Tracer;
  traceAnchor: TraceAnchor;
  anchors: AnchorsTable;
  chat: Chat;
  correlationId: string;
  timeout: number;
  today: string;
};

/** Pure: the URL from the arguments, nothing else. */
export function computeSendLink(args: SendLinkInput): { url: string } {
  const { from, to, email } = args;
  return { url: `/book?from=${from}&to=${to}&email=${encodeURIComponent(email)}` };
}

export type Refusal = { approved: false; error: string; reason: string };

/** The same check the plain tool runs, so the two can never disagree about a range. Null means the link may be built. */
export function verifySendLink(args: SendLinkInput, today: string): Refusal | null {
  const { from, to } = args;
  const result = computeCheckDates(args, today);
  if (result.ok === false) {
    const why = result.reason === "past_date" ? "in the past" : "not a valid range";
    return {
      approved: false,
      error: `Cannot build a link: ${from} to ${to} is ${why} (today is ${today}).`,
      reason: result.reason,
    };
  }
  if (!result.free) {
    return {
      approved: false,
      error: `Cannot build a link: ${from} to ${to} is not free.`,
      reason: "not_available",
    };
  }
  return null;
}

/**
 * The generic gate: the anchor row, the nudge in its own step, the wait.
 * Returns whether the approver said yes; a timeout is false.
 */
async function requestApprovalGate(params: {
  context: GatedContext;
  gateAnchor: TraceAnchor;
  reason: string;
}): Promise<boolean> {
  const { context, gateAnchor, reason } = params;
  const { step, tracer, anchors, chat, correlationId, timeout } = context;

  // The resume route gets only the id, hours later: the gate's anchor waits for it in a row.
  await step.run("record-gate-anchor", () => {
    anchors.record(correlationId, gateAnchor);
    return true;
  });

  // Its own step, apart from the wait: a replay must not nudge twice.
  const sent = await steppedSpan(step, tracer, "nudge-approver", gateAnchor, (span) => {
    span.setAttribute("correlation.id", correlationId);
    chat.post({ from: "agent", replyTo: null, ...composeDecision(correlationId, reason) });
    return true;
  });
  if (!sent) return false;

  const decision = await step.waitForEvent("wait-for-decision", {
    event: DECISION_EVENT,
    match: "data.correlationId",
    timeout,
  });
  const outcome =
    decision === null ? "timeout" : decision.data.approved === true ? "approved" : "rejected";
  await steppedSpan(step, tracer, "gate-decision", gateAnchor, (span) => {
    span.setAttribute("approval.decision", outcome);
    return outcome;
  });
  return outcome === "approved";
}

type GateDecision = { approved: true } | { approved: false; output: unknown };

/** The request half: the gate span, the re-check, then the gate. Never the real work. */
export async function requestSendLinkApproval(
  input: Record<string, unknown>,
  context: GatedContext,
): Promise<GateDecision> {
  const { step, tracer, traceAnchor, today } = context;

  // The gate span, created first: the nudge and the decision nest under it, and its anchor is what the row holds.
  const gateAnchor = await steppedSpan(step, tracer, "gate-send_link", traceAnchor, (span) => {
    span.setAttribute("tool.input", JSON.stringify(input));
    return span.anchor;
  });

  const parsed = sendLinkSchema.safeParse(input);
  if (!parsed.success) return { approved: false, output: invalidInput("send_link", parsed.error) };

  // Before anyone is asked: the approver is never nudged about a link that could not be built.
  const refusal = await step.run("verify-send_link", () => verifySendLink(parsed.data, today));
  if (refusal !== null) return { approved: false, output: refusal };

  const { from, to, email } = parsed.data;
  const approved = await requestApprovalGate({
    context,
    gateAnchor,
    reason: `Send the link for ${from} to ${to} to ${email}?`,
  });
  return approved ? { approved: true } : { approved: false, output: NOT_APPROVED };
}

/** The run half: reached only after a yes. The same one-shot shape as any plain tool. */
export function runSendLink(input: Record<string, unknown>, context: GatedContext) {
  return steppedSpan(context.step, context.tracer, "tool-send_link", context.traceAnchor, (span) =>
    dispatchToolExecution(span, input, () => {
      const parsed = sendLinkSchema.safeParse(input);
      if (!parsed.success) return invalidInput("send_link", parsed.error);
      return computeSendLink(parsed.data);
    }),
  );
}

export type TurnDeps = {
  tracer: Tracer;
  anchors: AnchorsTable;
  chat: Chat;
  timeout: number;
  today: string;
};

type TurnResult = { approved: boolean; output: unknown };

export type GatedTurn = { correlationId: string; anchor: TraceAnchor; run: DurableRun<TurnResult> };

/** The loop's gated branch: the request half decides, the run half runs only after a yes. */
function createTurnFunction(
  deps: TurnDeps,
  input: Record<string, unknown>,
): DurableFunction<TurnResult> {
  return async ({ event, step }) => {
    const correlationId = String(event.data.correlationId);
    const traceAnchor = event.data.traceAnchor as TraceAnchor;
    const context: GatedContext = { ...deps, step, traceAnchor, correlationId };

    const decision = await requestSendLinkApproval(input, context);
    if (!decision.approved) return { approved: false, output: decision.output };
    return { approved: true, output: await runSendLink(input, context) };
  };
}

/** The ingress: the root span, then the function with the anchor and the correlation id in its event. */
export async function receiveToolCall(
  deps: TurnDeps,
  params: { correlationId: string; input: Record<string, unknown> },
): Promise<GatedTurn> {
  const { correlationId, input } = params;
  const { anchor } = await deps.tracer.startRoot("message.received", (span) => {
    span.setAttribute("correlation.id", correlationId);
  });
  const run = createStepRunner(createTurnFunction(deps, input), {
    trigger: { name: "message.received", data: { correlationId, traceAnchor: anchor } },
  });
  await run.start();
  return { correlationId, anchor, run };
}

/**
 * The relay: the chat webhook and the resume route in one. The id comes
 * out of the button data, the anchor row is consumed once so the decision
 * nests under the gate span, and the event goes out as it came.
 */
export async function relayTap(
  deps: TurnDeps,
  turns: GatedTurn[],
  data: string,
): Promise<{ id: string | null; approved: boolean; nested: boolean; resumed: boolean }> {
  const parsed = parseButtonData(data);
  if (parsed === null) return { id: null, approved: false, nested: false, resumed: false };
  const { id, action } = parsed;
  const approved = action === "approve";

  const gate = deps.anchors.consume(id);
  const tag = (span: Span) => {
    span.setAttribute("correlation.id", id);
    span.setAttribute("approved", approved);
  };
  if (gate !== null) await deps.tracer.withSpan("decision", { parent: gate }, tag);
  else await deps.tracer.startRoot("decision", tag);

  let resumed = false;
  for (const turn of turns) {
    if (await turn.run.send({ name: DECISION_EVENT, data: { correlationId: id, approved } })) {
      resumed = true;
    }
  }
  return { id, approved, nested: gate !== null, resumed };
}
