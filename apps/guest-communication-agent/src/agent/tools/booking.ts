import { tool } from "ai";
import { z } from "zod";
import { dispatchToolExecution } from "@/agent/tool-execution";
import { flushTracing } from "@/instrumentation";
import { steppedSpan, type TraceAnchor, updateSpanIO } from "@/lib/tracing";
import { type HitlDecision, requestApprovalGate, resolveToolApproval } from "./approval-gate";
import { computeCheckAvailability } from "./availability";
import type { ToolContext } from "./config";
import { computeCurrentDate } from "./current-date";
import { type StayRangeProblem, validateStayRange } from "./stay-range";

// sendBookingLink is approve/reject-gated before the model ever sees a
// result: requestSendBookingLinkApproval ("calls human") creates the
// hitl.send_booking_link GATE span, then reuses approval-gate.ts's generic
// requestApprovalGate (this tool genuinely IS approve/reject-shaped, unlike
// missing_info); runSendBookingLink ("tool call") builds the URL, run only
// once approved, in its own fresh gen_ai.tool.send_booking_link EXECUTION
// span. Two different spans, not one shared span — see each function's own
// comment.

const sendBookingLinkSchema = z.object({
  guestName: z.string().describe("Guest full name"),
  email: z.string().email().describe("Guest email address"),
  room: z.enum(["room1", "room2"]).describe("Room they want to book"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

export const sendBookingLink = tool({
  description:
    "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name and email first if not known.",
  inputSchema: sendBookingLinkSchema,
});

// Shared so requestApprovalGate's wait and handleBookingLinkApprovalReceived's
// send can't drift apart.
export const BOOKING_LINK_APPROVAL_EVENT = "gca/booking-link.approval";

// Inngest's step.waitForEvent requires a bounded timeout (see
// requestApprovalGate's doc comment) — the owner must be able to
// approve/reject whenever they get to it, so "52w" (~1 year) stands in for
// "forever".
const BOOKING_LINK_APPROVAL_TIMEOUT = "52w";

// Owner-facing Telegram text only — the tool's own args/URL stay ISO.
function toEuropeanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}-${month}-${year}` : isoDate;
}

export function buildBookingApprovalReason(args: z.infer<typeof sendBookingLinkSchema>): string {
  const { guestName, room, checkIn, checkOut } = args;
  return `${guestName} wants to book ${room} from ${toEuropeanDate(checkIn)} to ${toEuropeanDate(checkOut)}.`;
}

// Shared so hitl-compliance.scorer.ts's bypass-detection logic derives from
// this file's real URL format instead of a hand-guessed copy. Keep in sync
// with the template literal in computeSendBookingLink below.
export const BOOKING_LINK_URL_PATTERN =
  /\/booking\/(?:room1|room2)\?checkIn=\d{4}-\d{2}-\d{2}&checkOut=\d{4}-\d{2}-\d{2}/;

type BookingRefusal = "not_available" | StayRangeProblem;

// Model-facing, guest-agnostic: names the dates that failed and today's
// date, so the model can correct itself without another tool round trip.
function describeBookingRefusal(
  reason: BookingRefusal,
  args: z.infer<typeof sendBookingLinkSchema>,
  today: string,
): string {
  const { room, checkIn, checkOut } = args;
  switch (reason) {
    case "invalid_date":
      return `Cannot build a booking link: ${checkIn} to ${checkOut} is not a valid YYYY-MM-DD range (today is ${today}).`;
    case "past_date":
      return `Cannot build a booking link: check-in ${checkIn} is in the past (today is ${today}). Re-read the dates from your earlier tool result in this conversation and call the tool again with them.`;
    case "invalid_range":
      return `Cannot build a booking link: check-out ${checkOut} is not after check-in ${checkIn}.`;
    case "not_available":
      return `Cannot build a booking link: ${room} is not available from ${checkIn} to ${checkOut}.`;
  }
}

// Independent re-verification of the model's own args: one computeCheckAvailability
// call covers both the date guard and the live availability re-check, so this
// tool and check_availability can never disagree about the same range. Returns
// null when the link may be built. An availability-endpoint outage still throws,
// the same failure mode check_availability already has in the same turn.
async function verifyBookingRequest(
  args: z.infer<typeof sendBookingLinkSchema>,
): Promise<{ approved: false; error: string; reason: BookingRefusal } | null> {
  const { room, checkIn, checkOut } = args;
  const availability = await computeCheckAvailability({ room, checkIn, checkOut });
  if (availability.available) {
    return null;
  }
  const reason: BookingRefusal = "reason" in availability ? availability.reason : "not_available";
  const today = "today" in availability ? availability.today : computeCurrentDate().date;
  return { approved: false, error: describeBookingRefusal(reason, args, today), reason };
}

// send_booking_link's "calls human" half: creates the hitl.send_booking_link
// GATE span first (not gen_ai.tool.send_booking_link — see run-agent-turn.ts's
// RULE comment for why nesting the wait under a span literally named "the
// tool call" would misrepresent the sequence), whose id becomes hitlAnchor,
// passed to requestApprovalGate so its nudge/decision/timeout spans nest as
// this gate span's real children. Patches its own span with the
// not-approved fallback on reject/timeout only — never on approval, since
// that result belongs to runSendBookingLink's own separate execution span.
// `payload` stays undefined: unlike missing_info's answer, `call.input`
// already has everything runSendBookingLink needs.
export async function requestSendBookingLinkApproval(
  call: { toolName: string; input: Record<string, unknown> },
  correlationId: string,
  context: ToolContext,
): Promise<HitlDecision> {
  const { conversationId, phone, step, traceAnchor } = context;

  const hitlSpanId = await steppedSpan(
    step,
    `hitl-${call.toolName}`,
    traceAnchor,
    `hitl.${call.toolName}`,
    {
      "gca.tool.input": JSON.stringify(call.input),
      "braintrust.input": JSON.stringify(call.input),
      "braintrust.tags": [call.toolName],
    },
    async (span) => span.spanContext().spanId,
  );
  // See updateSpanIO's doc comment (tracing.ts) for why this flush is needed.
  await flushTracing();
  const hitlAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: hitlSpanId };

  // After the gate span (so hitlSpanId/hitlAnchor are honest and the refusal
  // shows up as the gate's own output), before requestApprovalGate — the
  // owner is never nudged about a link that could not be built anyway.
  const refusal = await step.run("verify-send_booking_link-availability", () =>
    verifyBookingRequest(call.input as z.infer<typeof sendBookingLinkSchema>),
  );
  if (refusal) {
    await step.run("update-send_booking_link-refusal-trace-io", () =>
      updateSpanIO(hitlSpanId, { output: refusal }),
    );
    return { approved: false, notApprovedOutput: refusal, hitlSpanId, hitlAnchor };
  }

  const approved = await requestApprovalGate({
    toolName: call.toolName,
    event: BOOKING_LINK_APPROVAL_EVENT,
    timeout: BOOKING_LINK_APPROVAL_TIMEOUT,
    reason: buildBookingApprovalReason(call.input as z.infer<typeof sendBookingLinkSchema>),
    reasonCategory: "send_booking_link",
    conversationId,
    phone,
    correlationId,
    step,
    traceAnchor: hitlAnchor,
    // Captured on the pending_owner_decisions row so a later manual-resolve
    // action can rebuild this call without re-parsing the reason's prose.
    context: call.input,
  });

  // requestApprovalGate doesn't distinguish rejection from timeout (both
  // resolve `approved: false`), so neither does this.
  if (!approved) {
    const notApprovedOutput = {
      approved: false,
      message: "This action was not approved. Do not retry it automatically.",
    };
    await step.run("update-send_booking_link-trace-io", () =>
      updateSpanIO(hitlSpanId, { output: notApprovedOutput }),
    );
    return { approved: false, notApprovedOutput, hitlSpanId, hitlAnchor };
  }

  return { approved: true, hitlSpanId, hitlAnchor };
}

// Guarded URL builder, no tracing — kept separate from runSendBookingLink so
// src/app/api/admin/pending-decisions/[id]/actions/resolve/route.ts can
// rebuild the same URL to resend a stuck booking link, outside any live run.
export function computeSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  phone: string,
): { url: string } | { error: string; reason: StayRangeProblem } {
  const { guestName, email, room, checkIn, checkOut } = args;

  // Same guard check_availability runs, so no call path (including the admin
  // resend route) can turn an unusable range into a URL.
  const today = computeCurrentDate().date;
  const problem = validateStayRange(checkIn, checkOut, today);
  if (problem) {
    return { error: describeBookingRefusal(problem, args, today), reason: problem };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const url = `${siteUrl}/booking/${room}?checkIn=${checkIn}&checkOut=${checkOut}&phone=${encodeURIComponent(phone)}&guestName=${encodeURIComponent(guestName)}&email=${encodeURIComponent(email)}&source=gca`;
  return { url };
}

// send_booking_link's "tool call" half — only reached once approved. A
// one-shot dispatch, the same shape any plain tool's run<ToolName> has: no
// pre-created span, unlike the GATE span above.
export async function runSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  context: ToolContext,
) {
  return steppedSpan(
    context.step,
    "tool-send_booking_link",
    context.traceAnchor,
    "gen_ai.tool.send_booking_link",
    { "gen_ai.tool.name": "send_booking_link", "gen_ai.operation.name": "execute_tool" },
    (span) =>
      dispatchToolExecution(span, args, async () => computeSendBookingLink(args, context.phone)),
  );
}

// Thin wrapper around approval-gate.ts's generic resolveToolApproval. Unlike
// missing_info's reply handler, there's no KB/embedding write here — the
// event just carries a plain approved boolean.
export async function handleBookingLinkApprovalReceived(params: {
  correlationId: string;
  approved: boolean;
}): Promise<void> {
  await resolveToolApproval({ event: BOOKING_LINK_APPROVAL_EVENT, ...params });
}
