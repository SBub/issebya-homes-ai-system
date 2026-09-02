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

// Schema-only declaration — dispatched by run-turn.ts's runToolCall, straight
// to runWantsHuman below. A one-way alert with no decision to approve, so it
// has no entry in run-turn.ts's NEEDS_APPROVAL set.
export const wantsHuman = tool({
  description:
    "Alert the owner and hand off the conversation. Use when the guest explicitly asks to speak with a human/person, or when they've made a request only the owner can act on or approve (e.g. early check-in, a special accommodation) that you can't resolve yourself.",
  inputSchema: wantsHumanSchema,
});

// The tool's real dispatch: this app's run<ToolName> convention (see
// booking.ts's runSendBookingLink, missing-info.ts) — every tool's own
// execution lives in its own file under this name, called directly from
// run-turn.ts's runToolCall(). wants_human is a one-way alert with no
// suspend/resume of its own, so unlike missing_info/send_booking_link this
// resolves in one round trip: create the real gen_ai.tool.wants_human
// execution span FIRST (its `input` — the model's `reason` — is the one
// thing already known at this point), send the owner nudge as its real child
// (not a sibling of the turn's own anchor), then patch the span's `output`
// retroactively once the nudge's result is known.
//
// This is a deliberate exception to the general "tool files stay pure, no
// step/span/Inngest" posture most of src/agent/tools/*.ts holds to (see
// run-turn.ts's comment near `tools`): wants_human's own HITL-adjacent
// dispatch (like send_booking_link's/missing_info's) is real durability
// plumbing, and the established pattern is that it lives inside the tool's
// own run<ToolName>, not in run-turn.ts's dispatch loop. run-turn.ts calls
// this directly from its SELF_STEPPED_TOOLS branch, never nested inside
// another step.run() — Inngest doesn't support calling a step tool from
// inside another step.run()'s callback, the callback must be a
// self-contained unit of work.
export async function runWantsHuman(
  args: { reason: string },
  context: ToolContext,
): Promise<{ escalated: true; message: string }> {
  const { conversationId, phone, step, traceAnchor } = context;

  // Only `fn`'s return value (the real OTel-generated span id) survives this
  // step — the span itself has already closed by the time this resolves, no
  // live Span object can survive across this (or any) Inngest step boundary.
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
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands at Braintrust before this
  // function's own later updateSpanIO patch can fire. Without this
  // happens-before, whichever write lands last wins: the OTel export carries
  // no output of its own, so it can silently wipe the patch back to null if
  // it lands second (see updateSpanIO's own comment).
  await flushTracing();
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

  const nudged = await steppedSpan(
    step,
    "owner-nudge-wants-human",
    toolAnchor,
    "owner_nudge.wants_human",
    // braintrust.tags is also what gets this span past @braintrust/otel's
    // export filter at all (see tracing.ts's attribute-namespace comment
    // block) — this span's other attributes (gca.*) don't match any filter
    // prefix.
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

  // Retroactively patches the tool-call span's output now that it's known —
  // own step, not a span (patching a span isn't itself a new event worth its
  // own trace node).
  await step.run("update-wants-human-trace-io", () => updateSpanIO(toolSpanId, { output: result }));

  return result;
}
