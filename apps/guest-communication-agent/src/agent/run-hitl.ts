import { type HitlDecision } from "@/agent/tools/approval-gate";
import { requestSendBookingLinkApproval, runSendBookingLink } from "@/agent/tools/booking";
import type { ToolContext } from "@/agent/tools/config";
import { buildMissingInfoResult, requestMissingInfoApproval } from "@/agent/tools/missing-info";
import { updateSpanIO } from "@/lib/tracing";

// Which tools go through the two-phase "calls human, then run the tool"
// dispatch below, instead of the plain single-phase runTool (run-tool.ts).
// wants_human is NOT here on purpose — it's a one-way alert with no
// approve/reject (or answer-shaped) decision to gate on, so it dispatches
// straight through runTool via wants-human.ts's own runWantsHuman. Both
// tools below ARE approval-shaped (send_booking_link genuinely
// approve/reject; missing_info resolves to an answer instead, but still
// gates whether the tool call proceeds) — see approval-gate.ts's own module
// comment for why missing_info still doesn't reuse requestApprovalGate's
// generic mechanism despite being NEEDS_APPROVAL here.
export const NEEDS_APPROVAL = new Set(["missing_info", "send_booking_link"]);

// The "calls human" half for each NEEDS_APPROVAL tool — a switch, not a
// lookup table, matching run-tool.ts's own runTool dispatch style.
// requestMissingInfoApproval and requestSendBookingLinkApproval are NOT
// signature-symmetric: missing_info's correlationId already lives on
// `context` (ToolContext.correlationId), so it only takes (args, context);
// send_booking_link's dispatch predates that convention and still takes
// correlationId as its own explicit param. Kept as-is rather than forcing
// artificial symmetry between the two.
async function requestApproval(
  call: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  correlationId: string,
  context: ToolContext,
): Promise<HitlDecision<unknown>> {
  switch (call.toolName) {
    case "missing_info":
      return requestMissingInfoApproval(call.input as { reason: string }, context);
    case "send_booking_link":
      return requestSendBookingLinkApproval(call, correlationId, context);
    default:
      throw new Error(`requestApproval: "${call.toolName}" is not a NEEDS_APPROVAL tool`);
  }
}

// The "tool call" half — only ever reached once requestApproval above has
// resolved `approved: true`. `payload` is requestMissingInfoApproval's real
// answer for missing_info; send_booking_link ignores it (unused, undefined)
// since the model's own `input` already has everything runSendBookingLink
// needs.
function runApprovedTool(
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
      throw new Error(`runApprovedTool: "${toolName}" is not a NEEDS_APPROVAL tool`);
  }
}

// missing_info's own runMissingInfo (predating this file) already used a
// hardcoded "update-missing-info-trace-io" step id (hyphenated, matching the
// file name) before this dispatch existed here — not the
// `update-${toolName}-trace-io` template send_booking_link's own dispatch
// uses (which gives the underscored "update-send_booking_link-trace-io").
// The two were never symmetric; preserved exactly as each tool's tests/the
// hitl-compliance scorer already expect, rather than unifying them under one
// scheme now.
function traceIoStepId(toolName: string): string {
  return toolName === "missing_info"
    ? "update-missing-info-trace-io"
    : `update-${toolName}-trace-io`;
}

// The single entry point run-turn.ts's dispatch loop calls for any
// NEEDS_APPROVAL tool: request approval, then either return the not-approved
// fallback or run the real tool — patching the tool-call span's real output
// in both cases. Glues requestApproval/runApprovedTool together the same way
// missing-info.ts's own runMissingInfo glues
// requestMissingInfoApproval/buildMissingInfoResult for that tool alone;
// this is the shared version covering both NEEDS_APPROVAL tools, one call
// site instead of two.
export async function runHitl(
  call: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  correlationId: string,
  context: ToolContext,
): Promise<unknown> {
  const decision = await requestApproval(call, correlationId, context);

  if (!decision.approved) {
    await context.step.run(traceIoStepId(call.toolName), () =>
      updateSpanIO(decision.toolSpanId, { output: decision.notApprovedOutput }),
    );
    return decision.notApprovedOutput;
  }

  // Own step, distinct from the tool-span-creation step inside
  // requestApproval — this is the call's real dispatch, memoized separately
  // so a replay after some later suspend elsewhere in the same turn doesn't
  // re-run it.
  const output = await context.step.run(`execute-${call.toolName}`, () =>
    runApprovedTool(call.toolName, call.input, decision.payload, context),
  );
  await context.step.run(traceIoStepId(call.toolName), () =>
    updateSpanIO(decision.toolSpanId, { output }),
  );
  return output;
}
