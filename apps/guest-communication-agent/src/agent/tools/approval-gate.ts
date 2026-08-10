import type { GetStepTools } from "inngest";
import { inngest } from "@/lib/inngest";
import { steppedSpan, type TraceAnchor } from "@/lib/tracing";
import type { OwnerNudgeReason } from "./owner-nudge";
import { requestOwnerNudge } from "./owner-nudge";

// Generic, reusable real HITL approve/reject gate. This is the
// step.waitForEvent boilerplate extracted out of booking.ts's original
// send_booking_link-only implementation, so a future second approval-gated
// tool doesn't have to reimplement it from scratch.
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

/**
 * Sends an owner nudge and then suspends the current run via
 * step.waitForEvent until either a matching decision event arrives or the
 * given timeout elapses. Returns whether the action was approved.
 *
 * MUST be called directly from a runGuestTurn Inngest function's own
 * un-stepped loop body (never nested inside another step.run() callback) —
 * this function calls step.run() and step.waitForEvent() itself, and
 * Inngest does not support calling a step tool from inside another step's
 * callback (the callback must be a self-contained unit of work). This is
 * the same reasoning run-turn.ts's SELF_STEPPED_TOOLS set documents for
 * missing_info/wants_human/sendBookingLink.
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
  } = params;

  // Its own step, distinct from the wait-for-decision step below — sending
  // the nudge and waiting for the decision are two different kinds of
  // operation. Without this, a replay of this Inngest function (guaranteed
  // once step.waitForEvent below suspends and later resumes, since Inngest
  // replays the whole function body from the top) would re-send this real
  // Telegram nudge every single time, since un-stepped code isn't memoized
  // across replays the way step.waitForEvent itself is. Mirrors
  // missing-info.ts's "owner-nudge-missing-info" step and booking.ts's
  // original "owner-nudge-send-booking-link" step, which this generalizes.
  const nudged = await steppedSpan(
    step,
    `owner-nudge-${toolName}`,
    traceAnchor,
    `owner_nudge.${toolName}`,
    { "gca.conversation_id": conversationId, "gca.phone": phone },
    (span) => {
      // Braintrust aggregates a `braintrust.tags` value set on ANY span in
      // a trace up to the whole trace, so tagging this one span keeps a
      // turn that attempted a gated tool call filterable by tool name,
      // the same way run-turn.ts's old generic "tool-${toolName}" wrapper
      // tag did before this tool moved to SELF_STEPPED_TOOLS dispatch (see
      // run-turn.ts's comment there). Tagged at nudge-send time, not once
      // the decision is known, since a rejected/timed-out call is still
      // worth being able to find in a trace search. String arrays are a
      // native OTel attribute value — no JSON.stringify needed.
      span.setAttribute("braintrust.tags", [toolName]);
      return requestOwnerNudge({
        conversationId,
        phone,
        reason,
        reasonCategory,
        correlationId,
        step,
      });
    },
  );

  // Nudge failed to send — skip straight to the not-approved result; there's
  // no point suspending on a decision the owner was never actually told to
  // make. Same short-circuit reasoning missing-info.ts's runMissingInfo
  // applies for its own nudge-failed case.
  if (!nudged) {
    return false;
  }

  const result = await step.waitForEvent(`wait-for-${toolName}-approval`, {
    event,
    match: "data.correlationId",
    timeout,
  });

  if (result === null) {
    console.warn(
      `[approval-gate] requestApprovalGate("${toolName}") timed out after ${timeout} waiting for correlationId ${correlationId}'s decision — treating as not approved`,
    );
    // Own step — same replay-safety reasoning as the nudge-send step above:
    // without it, a later replay of this run would re-run this un-stepped
    // branch and duplicate-emit this span every time, since
    // step.waitForEvent's memoized resolution doesn't memoize the code
    // around it. In practice a well-chosen `timeout` should make this branch
    // rare-to-never for a tool like sendBookingLink, whose caller picks an
    // effectively-unbounded timeout.
    await steppedSpan(
      step,
      `${toolName}-approval-timeout`,
      traceAnchor,
      `owner_nudge.${toolName}.no_reply`,
      { "gca.timeout": timeout },
      async () => {},
    );
    return false;
  }

  return Boolean(result.data.approved);
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
