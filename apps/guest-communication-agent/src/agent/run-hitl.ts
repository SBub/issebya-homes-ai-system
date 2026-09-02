import { type HitlDecision } from "@/agent/tools/approval-gate";
import { requestSendBookingLinkApproval } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { requestMissingInfoApproval } from "@/agent/tools/missing-info";

// Which tools go through the two-phase "calls human, then run the tool"
// dispatch, instead of a single-phase call to run-tool.ts's runTool —
// checked directly in run-turn.ts's own dispatch loop, which calls
// requestApproval (this file) and, only if approved, run-tool.ts's runTool
// (given the resolved HitlDecision) as two separate, sequential steps; that
// decoupling is deliberate, not an implementation detail hidden in here.
// wants_human is NOT here on purpose — it's a one-way alert with no
// approve/reject (or answer-shaped) decision to gate on, so it dispatches
// straight through runTool via wants-human.ts's own runWantsHuman. Both
// tools below ARE approval-shaped (send_booking_link genuinely
// approve/reject; missing_info resolves to an answer instead, but still
// gates whether the tool call proceeds) — see approval-gate.ts's own
// module comment for why missing_info still doesn't reuse
// requestApprovalGate's generic mechanism.
export const NEEDS_APPROVAL = new Set(["missing_info", "send_booking_link"]);

// The approval half for each NEEDS_APPROVAL tool — a switch, not a lookup
// table, matching run-tool.ts's own runTool dispatch style. Never calls the
// tool itself — this only ever resolves a HitlDecision; execution happens
// separately, via run-tool.ts's runTool, once run-turn.ts's loop has seen
// `approved: true` here. Each of requestMissingInfoApproval/
// requestSendBookingLinkApproval already patches its own span with the
// not-approved outcome before returning it here, when that's the outcome —
// this function and its caller never touch span/step machinery of any kind,
// they only read `approved`/`payload`/`notApprovedOutput`.
// requestMissingInfoApproval and requestSendBookingLinkApproval are NOT
// signature-symmetric: missing_info's correlationId already lives on
// `context` (ToolContext.correlationId), so it only takes (args, context);
// send_booking_link's dispatch predates that convention and still takes
// correlationId as its own explicit param. Kept as-is rather than forcing
// artificial symmetry between the two.
export async function requestApproval(
  call: { toolName: string; input: Record<string, unknown> },
  correlationId: string,
  context: ToolContext,
): Promise<HitlDecision<unknown>> {
  switch (call.toolName) {
    case "missing_info":
      return requestMissingInfoApproval(call.input as { reason: string }, context);
    case "send_booking_link":
      return requestSendBookingLinkApproval(call, correlationId, context);
    default:
      throw new Error(`requestApproval: "${call.toolName}" is not a gated tool`);
  }
}
