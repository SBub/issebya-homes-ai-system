import { type HitlDecision } from "@/agent/tools/approval-gate";
import { requestSendBookingLinkApproval, runSendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { buildMissingInfoResult, requestMissingInfoApproval } from "@/agent/tools/missing-info";

// Which tools go through the two-phase "calls human, then run the tool"
// dispatch below, instead of the plain single-phase runTool (run-tool.ts) —
// checked directly in run-turn.ts's own dispatch loop, which calls
// requestApproval and runApprovedTool below as two separate, sequential
// steps (approval, then — only if approved — the tool call) rather than one
// function bundling both; that decoupling is deliberate, not an
// implementation detail hidden in here. wants_human is NOT here on purpose —
// it's a one-way alert with no approve/reject (or answer-shaped) decision to
// gate on, so it dispatches straight through runTool via wants-human.ts's
// own runWantsHuman. Both tools below ARE approval-shaped (send_booking_link
// genuinely approve/reject; missing_info resolves to an answer instead, but
// still gates whether the tool call proceeds) — see approval-gate.ts's own
// module comment for why missing_info still doesn't reuse
// requestApprovalGate's generic mechanism.
export const NEEDS_APPROVAL = new Set(["missing_info", "send_booking_link"]);

// The approval half for each NEEDS_APPROVAL tool — a switch, not a lookup
// table, matching run-tool.ts's own runTool dispatch style. Never calls the
// tool itself (see runApprovedTool below for that, a fully separate
// function) — this only ever resolves a HitlDecision. requestMissingInfoApproval
// and requestSendBookingLinkApproval are NOT signature-symmetric:
// missing_info's correlationId already lives on `context`
// (ToolContext.correlationId), so it only takes (args, context);
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

// The tool-call half — only ever called by run-turn.ts's loop once
// requestApproval above has resolved `approved: true`; never calls
// requestApproval itself, never decides approval. `payload` is
// requestMissingInfoApproval's real answer for missing_info (its actual
// "tool call" is just formatting that answer, buildMissingInfoResult);
// send_booking_link ignores `payload` (unused, undefined) since the model's
// own `input` already has everything runSendBookingLink needs.
export function runApprovedTool(
  toolName: string,
  input: Record<string, unknown>,
  payload: unknown,
  context: ToolContext,
): Promise<unknown> {
  switch (toolName) {
    case "missing_info":
      return Promise.resolve(buildMissingInfoResult(payload as string));
    case "send_booking_link":
      return runSendBookingLink(input as Parameters<typeof runSendBookingLink>[0], {
        phone: context.phone,
      });
    default:
      throw new Error(`runApprovedTool: "${toolName}" is not a gated tool`);
  }
}

// missing_info's own runMissingInfo (predating the requestApproval/
// runApprovedTool split above) already used a hardcoded
// "update-missing-info-trace-io" step id (hyphenated, matching the file
// name) before this dispatch existed — not the `update-${toolName}-trace-io`
// template send_booking_link's own dispatch uses (which gives the
// underscored "update-send_booking_link-trace-io"). The two were never
// symmetric; preserved exactly as each tool's tests/the hitl-compliance
// scorer already expect, rather than unifying them under one scheme now.
// Exported so run-turn.ts's loop (the only caller of requestApproval/
// runApprovedTool) can patch the tool-call span's real output under the
// same step id either path already used.
export function traceIoStepId(toolName: string): string {
  return toolName === "missing_info"
    ? "update-missing-info-trace-io"
    : `update-${toolName}-trace-io`;
}
