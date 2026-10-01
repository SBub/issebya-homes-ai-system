import { createFakeModel, type Message, type ScriptedRound } from "@/lib/harness/fake-model";
import type { BatchExporter, Span, TraceAnchor, Tracer } from "@/lib/harness/span-exporter";
import {
  createStepRunner,
  type DurableFunction,
  type DurableRun,
  type StepEvent,
} from "@/lib/harness/step-runner";
import { type MessagesTable, recordReply } from "@/lib/idempotent-write/record-reply";
import {
  type AnchorsTable,
  DECISION_EVENT,
  steppedSpan,
} from "@/lib/trace-anchor/anchored-request";

/**
 * The composite behind the `durable-agent-turn` demo: one turn, from the
 * request that receives a message to the reply that goes out, on the
 * harness runtime. It is the shape of GCA's run-guest-turn.ts:
 *
 * - The ingress opens the root span, records the inbound message, and
 *   starts the durable function with the root's anchor and a correlation id
 *   in the trigger event (trace-anchor-across-steps).
 * - Every side effect in the function is its own step, and every step
 *   opens its own span under the anchor (step-memoized-side-effects).
 * - The loop calls the scripted model, dispatches the tools itself, and
 *   pauses on the gated tool for a decision (manual-tool-loop,
 *   approval-gate-wait-for-event).
 * - The reply row is keyed by the trace id, so a retried write returns
 *   the existing row (idempotent-write-by-trace-key).
 * - Each request flushes the exporter after its response
 *   (flush-before-freeze), which the demo does after every action.
 */

export const MESSAGE_EVENT = "message.received";

export type TurnDeps = {
  tracer: Tracer;
  exporter: BatchExporter;
  messages: MessagesTable;
  anchors: AnchorsTable;
  notify: (text: string) => void;
  timeout: number;
};

type TurnResult = { replyText: string; replyRowId: number; rounds: number };

const MAX_ROUNDS = 4;
const FALLBACK_TEXT = "Sorry, I could not process that. Please try again shortly.";
const NOT_APPROVED = { approved: false, message: "This action was not approved. Do not retry it." };

const SCRIPT: ScriptedRound[] = [
  { toolCalls: [{ toolName: "check_dates", input: { from: "2026-10-06", to: "2026-10-08" } }] },
  { toolCalls: [{ toolName: "send_link", input: { from: "2026-10-06", to: "2026-10-08" } }] },
  { text: "The 6th to the 8th is free. The link is on its way." },
];

const GATED_TOOL = "send_link";

function runTool(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "check_dates":
      return { free: true, from: input.from, to: input.to };
    default:
      return { error: `Unknown tool "${name}".` };
  }
}

function createTurnFunction(deps: TurnDeps): DurableFunction<TurnResult> {
  const { tracer, messages: table, anchors, notify, timeout } = deps;
  // One scripted model per turn. A memoized round never calls it, so after a
  // replay its next answer is still the next round, as a real model's would be.
  const model = createFakeModel(SCRIPT);

  return async ({ event, step }) => {
    const conversationId = String(event.data.conversationId);
    const correlationId = String(event.data.correlationId);
    const traceAnchor = event.data.traceAnchor as TraceAnchor;

    // One child of the root per turn; everything below nests under it.
    const turnAnchor = await steppedSpan(step, tracer, "turn", traceAnchor, (span) => {
      span.setAttribute("conversation.id", conversationId);
      return span.anchor;
    });

    const history = await steppedSpan(step, tracer, "load-history", turnAnchor, () =>
      table
        .selectBy("conversationId", conversationId)
        .map((row): Message => ({ role: row.role, content: row.content })),
    );
    // The history already ends with this turn's inbound message; the ingress recorded it.
    let messages: Message[] = history;
    let replyText = FALLBACK_TEXT;

    let round = 0;
    while (round < MAX_ROUNDS) {
      round += 1;
      const reply = await steppedSpan(step, tracer, `model-${round}`, turnAnchor, () =>
        model.generate(messages),
      );

      if (reply.toolCalls.length === 0) {
        replyText = reply.text.trim() === "" ? FALLBACK_TEXT : reply.text;
        break;
      }

      const outputs: unknown[] = [];
      for (const call of reply.toolCalls) {
        if (call.toolName !== GATED_TOOL) {
          outputs.push(
            await steppedSpan(step, tracer, `tool-${call.toolCallId}`, turnAnchor, () =>
              runTool(call.toolName, call.input),
            ),
          );
          continue;
        }
        // The gated tool: nudge in one step, wait in another, run only after a yes.
        await steppedSpan(step, tracer, "notify-approver", turnAnchor, (span) => {
          anchors.record(correlationId, span.anchor);
          notify(`Approve sending the link? (${correlationId})`);
          return true;
        });
        const decision = await step.waitForEvent("wait-for-decision", {
          event: DECISION_EVENT,
          match: "data.correlationId",
          timeout,
        });
        const approved = decision !== null && decision.data.approved === true;
        outputs.push(
          approved
            ? await steppedSpan(step, tracer, "send-link", turnAnchor, () => ({
                approved: true,
                url: `/conversations/${conversationId}/link`,
              }))
            : NOT_APPROVED,
        );
      }
      messages = [
        ...messages,
        ...reply.response.messages,
        {
          role: "tool",
          content: reply.toolCalls.map((call, index) => ({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: outputs[index],
          })),
        },
      ];
    }

    const replyRowId = await steppedSpan(step, tracer, "record-reply", turnAnchor, (span) => {
      const outcome = recordReply(table, {
        conversationId,
        content: replyText,
        traceId: traceAnchor.traceId,
      });
      span.setAttribute("row.outcome", outcome.outcome);
      return outcome.id;
    });

    await steppedSpan(step, tracer, "send-reply", turnAnchor, (span) => {
      span.setAttribute("reply.length", replyText.length);
      notify(`Reply to ${conversationId}: ${replyText}`);
      return true;
    });

    return { replyText, replyRowId, rounds: round };
  };
}

export type Turn = { correlationId: string; anchor: TraceAnchor; run: DurableRun<TurnResult> };

/** The ingress: root span, inbound row, the trigger event with the anchor as data, the run started. */
export async function receiveMessage(
  deps: TurnDeps,
  input: { conversationId: string; text: string; correlationId: string },
): Promise<Turn> {
  const { tracer, messages } = deps;
  const { conversationId, text, correlationId } = input;

  const { anchor } = await tracer.startRoot("message.received", async (span) => {
    span.setAttribute("conversation.id", conversationId);
    await tracer.withSpan("record-inbound", {}, () =>
      messages.insert({ conversationId, role: "user", content: text, traceId: null }),
    );
  });

  const trigger: StepEvent = {
    name: MESSAGE_EVENT,
    data: { conversationId, text, correlationId, traceAnchor: anchor },
  };
  const run = createStepRunner(createTurnFunction(deps), { trigger });
  await run.start();
  return { correlationId, anchor, run };
}

/**
 * The resume route, as in the trace anchor atom: the decision as a span under
 * the gate when its anchor row is there, else as its own root tagged with the
 * correlation id, then the event. The send comes after the span so the replay
 * it causes runs with no ambient span.
 */
export async function decideTurn(
  deps: TurnDeps,
  turn: Turn,
  approved: boolean,
): Promise<{ nested: boolean; resumed: boolean }> {
  const { tracer, anchors } = deps;
  const { correlationId, run } = turn;
  const gate = anchors.consume(correlationId);

  const tag = (span: Span) => {
    span.setAttribute("correlation.id", correlationId);
    span.setAttribute("approved", approved);
  };
  if (gate !== null) await tracer.withSpan("decision", { parent: gate }, tag);
  else await tracer.startRoot("decision", tag);

  const resumed = await run.send({ name: DECISION_EVENT, data: { correlationId, approved } });
  return { nested: gate !== null, resumed };
}
