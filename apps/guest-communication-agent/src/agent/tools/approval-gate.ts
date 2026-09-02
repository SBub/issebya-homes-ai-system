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

// Generic, reusable real HITL approve/reject gate: the step.waitForEvent
// boilerplate for sending a nudge and suspending until a decision or
// timeout, shared by any tool that needs owner approval before dispatching
// (see booking.ts for the single-tool pattern this generalizes).
//
// Deliberate split of responsibility: this file only knows the *mechanism*
// (send a nudge, then suspend until a decision or a timeout). It does NOT
// know which tools need approval, or what event/timeout a given tool should
// use — that's a policy choice, and it lives at the call site
// (run-turn.ts's APPROVAL_GATES table) so it's visible in the runtime
// dispatch loop instead of buried in a tool's own file. See run-turn.ts's
// APPROVAL_GATES/SELF_STEPPED_TOOLS comments for the other half of this
// split.
//
// Not a fit for every suspend/resume flow in this app: missing_info's
// suspend resolves to an answer STRING to embed into the KB, not a yes/no
// decision — it is not approve/reject-shaped, so it intentionally does not
// use this gate and keeps its own step.waitForEvent call in missing-info.ts.
// wants_human is a one-way alert with no decision at all, so it needs no
// gate of any kind.

// Shared result shape for any tool's "calls human" half (the HITL
// nudge/wait), kept separate from that tool's own "tool call" half — see
// booking.ts's requestSendBookingLinkApproval and missing-info.ts's
// requestMissingInfoApproval, the two real implementations of this contract.
// Both resolve completely differently (a plain approve/reject vs. an
// owner-supplied answer string) but return this one shape so their callers
// don't need to know which. `payload` is generic precisely because of that
// difference — undefined for a tool with nothing more to hand the execute
// step than the model's own original args (send_booking_link), a real value
// for one that needs it (missing_info's answer).
export interface HitlDecision<TPayload = undefined> {
  approved: boolean;
  // Only set when approved.
  payload?: TPayload;
  // Only set when NOT approved — handed straight back to the model as the
  // "rejected/timed out"/"couldn't reach the owner" result, whichever shape
  // this tool uses.
  notApprovedOutput?: unknown;
  // The gen_ai.tool.<name> execution span, created before the HITL wait —
  // the caller patches its real output onto this once the tool call (or the
  // not-approved fallback) resolves.
  toolSpanId: string;
  toolAnchor: TraceAnchor;
}

/**
 * Sends an owner nudge and then suspends the current run via
 * step.waitForEvent until either a matching decision event arrives or the
 * given timeout elapses. Returns whether the action was approved.
 *
 * MUST be called directly from a runGuestTurn Inngest function's own
 * un-stepped loop body, never nested inside another step.run() callback —
 * this function calls step.run() and step.waitForEvent() itself. See
 * run-turn.ts's SELF_STEPPED_TOOLS comment for why that nesting is unsafe;
 * this is the same constraint, for the same three tools.
 *
 * `event` and `timeout` are params, not constants in this file — which
 * event a decision arrives on, and how long to wait for it, is a
 * tool-specific policy choice made at the call site (see run-turn.ts's
 * APPROVAL_GATES table), not something this generic mechanism should bake
 * in. Inngest's step.waitForEvent requires a bounded `timeout` string (see
 * node_modules/inngest/types.d.ts's waitForEvent zod schema — timeout is a
 * required, pattern-matched duration like `${number}w`/`d`/`h`/`m`/`s`;
 * there is no literal "wait forever" option), so a tool that wants an
 * effectively-unbounded wait (like sendBookingLink's "52w") still has to
 * pick some bounded string — that choice belongs to the caller, not here.
 */
export async function requestApprovalGate(params: {
  // The tool this gate is guarding — used to derive step ids/span names and
  // as the Braintrust tag value, so a trace stays filterable by which tool
  // triggered the gate.
  toolName: string;
  // Event name a matching decision (see resolveToolApproval below) arrives
  // on. Must be unique per gated tool so decisions can't cross-resolve each
  // other's waits.
  event: string;
  // Bounded duration string Inngest's step.waitForEvent requires — see this
  // function's own doc comment above for why there's no "forever" option.
  timeout: string;
  // Human-readable text the owner sees in the Telegram nudge.
  reason: string;
  reasonCategory: OwnerNudgeReason;
  conversationId: string;
  phone: string;
  correlationId: string;
  step: GetStepTools<typeof inngest>;
  traceAnchor: TraceAnchor;
  // The gated tool call's own real args (e.g. send_booking_link's
  // guestName/room/checkIn/checkOut) — captured on the pending_owner_decisions
  // row below so a later manual-resolve action can rebuild what this call
  // would have done without re-parsing `reason`'s human-readable prose. See
  // pending-owner-decisions.ts's insertPendingOwnerDecision for the full
  // reasoning.
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

  // Best-effort write, own step (not a span — this is pure DB bookkeeping,
  // not something worth showing in Braintrust's UI) — see
  // recordApprovalGateTraceAnchor's own doc comment in tracing.ts for what
  // this is for (letting the owner-nudges approve route, a separate HTTP
  // request that may run hours later on a different server instance, nest
  // its own decision span under this call's real gen_ai.tool.<toolName>
  // span) and its known orphaned-row gap when the owner never decides.
  // `traceAnchor` here already IS that gen_ai.tool.<toolName> span's real
  // anchor — run-turn.ts's dispatchGatedToolCall creates that span first and
  // passes its anchor in as this param, the same shape runMissingInfo's own
  // toolAnchor has relative to gen_ai.tool.missing_info — so no live Span
  // object is needed here, unlike missing_info's equivalent call this
  // doesn't need a correlationId truthiness guard either: unlike
  // ToolContext.correlationId (optional, for hypothetical callers outside a
  // live run), this function's own `correlationId` param above is a
  // required string.
  await step.run(`record-approval-gate-trace-anchor-${toolName}`, () =>
    recordApprovalGateTraceAnchor(correlationId, traceAnchor),
  );

  // Its own step, distinct from the wait-for-decision step below — sending
  // the nudge and waiting for the decision are two different kinds of
  // operation, each needing its own memoized step id (see steppedSpan's doc
  // comment in tracing.ts for why un-stepped code would otherwise re-send
  // this real Telegram nudge on every replay). Mirrors missing-info.ts's
  // "owner-nudge-missing-info" step and booking.ts's original
  // "owner-nudge-send-booking-link" step, which this generalizes.
  // braintrust.tags aggregates up to the whole trace from any span (see
  // tracing.ts's withTurnSpan doc comment), so tagging this one span
  // keeps a turn that attempted a gated tool call filterable by tool
  // name. Tagged at nudge-send time, not once the decision is known,
  // since a rejected/timed-out call is still worth being able to find
  // in a trace search.
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
    `owner-nudge-${toolName}`,
    traceAnchor,
    `owner_nudge.${toolName}`,
    {
      "gca.conversation_id": conversationId,
      "gca.phone": phone,
      "gca.correlation_id": correlationId,
    },
    sendGatedOwnerNudge,
  );

  // Nudge failed to send — skip straight to the not-approved result; there's
  // no point suspending on a decision the owner was never actually told to
  // make. Same short-circuit reasoning missing-info.ts's runMissingInfo
  // applies for its own nudge-failed case.
  if (!nudged) {
    return false;
  }

  // Best-effort bookkeeping (see insertPendingOwnerDecision's own doc
  // comment) — own step, only reached once the nudge is confirmed sent, so
  // an admin recovery UI never lists a row the owner was never actually
  // told about.
  await step.run("record-pending-decision", () =>
    insertPendingOwnerDecision({
      correlationId,
      // Every APPROVAL_GATES entry today (send_booking_link) is one of
      // pending_owner_decisions' two allowed tool_name values — see
      // run-turn.ts's APPROVAL_GATES table for the (currently) one real
      // caller of this whole gate.
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
    // Own step — same replay-safety reasoning as the nudge-send step above.
    // In practice a well-chosen `timeout` should make this branch
    // rare-to-never for a tool like sendBookingLink, whose caller picks an
    // effectively-unbounded timeout. gca.approval.decision here is the same
    // attribute (and one of the same three string values — "approved",
    // "rejected", "timeout") the decision-recording span below sets on the
    // approved/rejected paths, so a scorer can check "was this gate's
    // decision ever recorded" with one attribute name regardless of outcome.
    // braintrust.approval_decision duplicates that same value under a
    // braintrust.*-prefixed key — needed for this span to clear
    // @braintrust/otel's export filter at all (see tracing.ts's
    // updateSpanIO-adjacent comment block for why), not to change what
    // Braintrust's UI does with it.
    await steppedSpan(
      step,
      `${toolName}-approval-timeout`,
      traceAnchor,
      `owner_nudge.${toolName}.no_reply`,
      {
        "gca.timeout": timeout,
        "gca.approval.decision": "timeout",
        "braintrust.approval_decision": "timeout",
        "gca.correlation_id": correlationId,
      },
      async () => {},
    );
    // Best-effort bookkeeping, own step — same posture as the
    // record-pending-decision step above.
    await step.run("resolve-pending-decision-timeout", () =>
      resolvePendingOwnerDecisionByCorrelationId(correlationId, "timeout"),
    );
    return false;
  }

  // No existing span covers this moment — the nudge span above already
  // closed before step.waitForEvent resolved. Own marker span so the actual
  // approve/reject decision (not just that a decision was eventually made)
  // is independently visible in the trace, with the same gca.approval.decision
  // attribute name/type (a string, matching "timeout" above) the timeout
  // branch sets, so all three real outcomes are checkable via one code path.
  // braintrust.approval_decision here is the same export-filter necessity as
  // the timeout branch above — see that branch's comment.
  const approved = Boolean(result.data.approved);
  const decision = approved ? "approved" : "rejected";
  await steppedSpan(
    step,
    `${toolName}-approval-decision`,
    traceAnchor,
    `owner_nudge.${toolName}.decision`,
    {
      "gca.approval.decision": decision,
      "braintrust.approval_decision": decision,
      "gca.correlation_id": correlationId,
    },
    async () => {},
  );
  // Best-effort bookkeeping, own step — same posture as the
  // record-pending-decision step above. `decision` is already "approved" or
  // "rejected" here, both real pending_owner_decisions resolution values.
  await step.run("resolve-pending-decision", () =>
    resolvePendingOwnerDecisionByCorrelationId(correlationId, decision),
  );
  return approved;
}

/**
 * Relays an out-of-band approve/reject decision (e.g. the owner tapping a
 * Telegram button) into the given event, so a suspended requestApprovalGate
 * call — if one is still actually waiting on a matching correlationId — picks
 * it up. Generalizes booking.ts's original handleBookingLinkApprovalReceived.
 *
 * Deliberately does nothing else: no KB/embedding write, no DB lookup — that
 * class of side effect is missing_info-only (it resolves to an answer to
 * embed, not a yes/no decision) and stays in missing-info.ts, never folded
 * into this generic gate. This function is a one-liner on purpose.
 *
 * Same caveat as missing-info.ts's handleMissingInfoReplyReceived:
 * inngest.send() gives no signal about whether a matching waiter still
 * existed — sending an event nobody's waiting on isn't an error, it's simply
 * never consumed. This resolves once the event has been accepted by Inngest,
 * nothing more; a duplicate or late call is a safe no-op.
 */
export async function resolveToolApproval(params: {
  event: string;
  correlationId: string;
  approved: boolean;
}): Promise<void> {
  const { event, correlationId, approved } = params;
  await inngest.send({ name: event, data: { correlationId, approved } });
}
