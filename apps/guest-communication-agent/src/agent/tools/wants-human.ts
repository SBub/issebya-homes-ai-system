import { tool } from "ai";
import { z } from "zod";
import { flushTracing } from "@/instrumentation";
import { steppedSpan, type TraceAnchor, updateSpanIO } from "@/lib/tracing";
import type { ToolContext } from "./config";
import { requestOwnerNudge } from "./owner-nudge";

const wantsHumanSchema = z.object({
  reason: z
    .string()
    .describe(
      "This text becomes the entire context an owner sees in the Telegram alert (shown as \"Guest {phone} needs you: {reason}\") — write more than the bare trigger phrase: summarize what's been discussed so far (topic, any relevant details the guest already shared, their name if known) and specifically why they're asking to speak with a person, so the owner can pick up the conversation without it reading blank.",
    ),
});

// A one-way alert with no decision to approve, so it has no entry in
// run-turn.ts's NEEDS_APPROVAL set.
export const wantsHuman = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest explicitly asks to speak with a human/person, or when they've made a request only the owner can act on or approve (e.g. early check-in, a special accommodation) that you can't resolve yourself.",
  inputSchema: wantsHumanSchema,
});

// wants_human is a one-way alert with no suspend/resume, so unlike
// missing_info/send_booking_link this resolves in one round trip: create
// the gen_ai.tool.wants_human span FIRST (input already known), send the
// nudge as its real child, then patch `output` once the nudge result is
// known. Deliberate exception to "tool files stay pure" (run-turn.ts's RULE
// comment) — real durability plumbing lives here, not in the dispatch loop.
export async function runWantsHuman(
  args: { reason: string },
  context: ToolContext,
): Promise<{ escalated: true; message: string }> {
  const { conversationId, phone, step, traceAnchor } = context;

  const toolSpanId = await steppedSpan(
    step,
    "tool-wants_human",
    traceAnchor,
    "gen_ai.tool.wants_human",
    {
      "gen_ai.tool.name": "wants_human",
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(args),
      "braintrust.input": JSON.stringify(args),
    },
    async (span) => span.spanContext().spanId,
  );
  // See updateSpanIO's doc comment (tracing.ts) for why this flush must
  // happen before the later patch below.
  await flushTracing();
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  const nudged = await steppedSpan(
    step,
    "owner-nudge-wants-human",
    toolAnchor,
    "owner_nudge.wants_human",
    // braintrust.tags clears the export filter — see tracing.ts's
    // Braintrust-attribute-namespace comment.
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "braintrust.tags": ["wants_human"],
    },
    () =>
      requestOwnerNudge({
        conversationId,
        phone,
        reason: args.reason,
        reasonCategory: "wants_human",
        step,
      }),
  );

  const result: { escalated: true; message: string } = nudged
    ? { escalated: true, message: "The owner has been notified and will be in touch shortly." }
    : {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      };

  await step.run("update-wants-human-trace-io", () => updateSpanIO(toolSpanId, { output: result }));

  return result;
}
