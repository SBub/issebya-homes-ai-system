import type { Span } from "@opentelemetry/api";
import type { GetStepTools } from "inngest";
import { inngest } from "@/lib/inngest";
import {
  insertPendingOwnerDecision,
  type PendingOwnerDecisionToolName,
  resolvePendingOwnerDecisionByCorrelationId,
} from "@/lib/pending-owner-decisions";
import { recordApprovalGateTraceAnchor, steppedSpan, type TraceAnchor } from "@/lib/tracing";
import type { OwnerNudgeReason } from "./owner-nudge";
import { requestOwnerNudge } from "./owner-nudge";

// Generic, reusable HITL approve/reject gate — the step.waitForEvent
// boilerplate for sending a nudge and suspending until a decision or
// timeout — shared by any tool that needs owner approval before dispatching.
// Only knows the *mechanism*; which tools need approval and their
// event/timeout is a policy choice at the call site (run-agent-turn.ts's
// NEEDS_APPROVAL/booking.ts).
//
// Not a fit for every suspend/resume flow: missing_info's suspend resolves
// to an answer STRING to embed, not a yes/no decision, so it keeps its own
// step.waitForEvent in missing-info.ts instead. wants_human has no decision
// at all, so it needs no gate.

// Shared result shape for any tool's "calls human" half, kept separate from
// its "tool call" half. `payload` is generic because the two real
// implementations (booking.ts, missing-info.ts) resolve differently —
// undefined when the model's own args already have everything the execute
// step needs, a real value (missing_info's answer) otherwise.
export interface HitlDecision<TPayload = undefined> {
  approved: boolean;
  // Only set when approved.
  payload?: TPayload;
  // Only set when NOT approved.
  notApprovedOutput?: unknown;
  // The hitl.<name> gate span — the caller patches its own output onto this
  // only if NOT approved (the approved path creates a separate fresh
  // gen_ai.tool.<name> execution span instead).
  hitlSpanId: string;
  hitlAnchor: TraceAnchor;
}

/**
 * Sends an owner nudge, then suspends via step.waitForEvent until a
 * matching decision arrives or `timeout` elapses. Returns whether approved.
 *
 * LANDMINE: must be called directly from an un-stepped loop body, never
 * nested inside another step.run() callback — see run-agent-turn.ts's RULE
 * comment. `event`/`timeout` are params, not constants, since which event
 * and how long to wait is a tool-specific policy choice at the call site.
 * Inngest's step.waitForEvent requires a bounded timeout string (no literal
 * "wait forever"), so an effectively-unbounded wait (sendBookingLink's
 * "52w") still has to pick a bounded string.
 */
export async function requestApprovalGate(params: {
  toolName: string;
  // Must be unique per gated tool so decisions can't cross-resolve waits.
  event: string;
  timeout: string;
  reason: string;
  reasonCategory: OwnerNudgeReason;
  conversationId: string;
  phone: string;
  correlationId: string;
  step: GetStepTools<typeof inngest>;
  traceAnchor: TraceAnchor;
  // Captured on the pending_owner_decisions row so a later manual-resolve
  // action can rebuild this call without re-parsing `reason`'s prose.
  context?: Record<string, unknown>;
}): Promise<boolean> {
  const {
    toolName,
    event,
    timeout,
    reason,
    reasonCategory,
    conversationId,
    phone,
    correlationId,
    step,
    traceAnchor,
    context,
  } = params;

  // See recordApprovalGateTraceAnchor's doc comment (tracing.ts). Unlike
  // missing_info's equivalent call, no correlationId truthiness guard is
  // needed — this function's own param is a required string.
  await step.run(`record-approval-gate-trace-anchor-${toolName}`, () =>
    recordApprovalGateTraceAnchor(correlationId, traceAnchor),
  );

  // Own step, distinct from the wait-for-decision step below, so un-stepped
  // code can't re-send this Telegram nudge on replay. Tagged at nudge-send
  // time (not once the decision is known) since a rejected/timed-out call
  // is still worth finding in a trace search.
  function sendGatedOwnerNudge(span: Span): Promise<boolean> {
    span.setAttribute("braintrust.tags", [toolName]);
    return requestOwnerNudge({
      conversationId,
      phone,
      reason,
      reasonCategory,
      correlationId,
      step,
    });
  }

  const nudged = await steppedSpan(
    step,
    `hitl-${toolName}-nudge`,
    traceAnchor,
    `hitl.${toolName}.nudge`,
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "gca.correlation_id": correlationId,
    },
    sendGatedOwnerNudge,
  );

  if (!nudged) {
    return false;
  }

  // Only reached once the nudge is confirmed sent, so an admin recovery UI
  // never lists a row the owner was never actually told about.
  await step.run("record-pending-decision", () =>
    insertPendingOwnerDecision({
      correlationId,
      toolName: toolName as PendingOwnerDecisionToolName,
      conversationId,
      phone,
      reason,
      context,
    }),
  );

  const result = await step.waitForEvent(`wait-for-${toolName}-approval`, {
    event,
    match: "data.correlationId",
    timeout,
  });

  if (result === null) {
    console.warn(
      `[approval-gate] requestApprovalGate("${toolName}") timed out after ${timeout} waiting for correlationId ${correlationId}'s decision — treating as not approved`,
    );
    // gca.approval.decision matches the decision-recording span below (same
    // attribute, same 3 possible values), so a scorer can check "was a
    // decision ever recorded" via one attribute regardless of outcome.
    // braintrust.approval_decision duplicates it to clear the export filter
    // — see tracing.ts's Braintrust-attribute-namespace comment.
    await steppedSpan(
      step,
      `hitl-${toolName}-no-reply`,
      traceAnchor,
      `hitl.${toolName}.no_reply`,
      {
        "gca.timeout": timeout,
        "gca.approval.decision": "timeout",
        "braintrust.approval_decision": "timeout",
        "gca.correlation_id": correlationId,
      },
      async () => {},
    );
    await step.run("resolve-pending-decision-timeout", () =>
      resolvePendingOwnerDecisionByCorrelationId(correlationId, "timeout"),
    );
    return false;
  }

  // No existing span covers this moment — the nudge span above already
  // closed before step.waitForEvent resolved. Own marker span, same
  // gca.approval.decision/braintrust.approval_decision attributes as the
  // timeout branch above, so all three real outcomes are checkable one way.
  const approved = Boolean(result.data.approved);
  const decision = approved ? "approved" : "rejected";
  await steppedSpan(
    step,
    `hitl-${toolName}-decision`,
    traceAnchor,
    `hitl.${toolName}.decision`,
    {
      "gca.approval.decision": decision,
      "braintrust.approval_decision": decision,
      "gca.correlation_id": correlationId,
    },
    async () => {},
  );
  await step.run("resolve-pending-decision", () =>
    resolvePendingOwnerDecisionByCorrelationId(correlationId, decision),
  );
  return approved;
}

/**
 * Relays an out-of-band approve/reject decision (e.g. a Telegram button tap)
 * into the given event, so a suspended requestApprovalGate call — if still
 * waiting on a matching correlationId — picks it up. Deliberately does
 * nothing else (no KB/DB lookup, that's missing_info-only). A duplicate/late
 * call is a safe no-op.
 */
export async function resolveToolApproval(params: {
  event: string;
  correlationId: string;
  approved: boolean;
}): Promise<void> {
  const { event, correlationId, approved } = params;
  await inngest.send({ name: event, data: { correlationId, approved } });
}
