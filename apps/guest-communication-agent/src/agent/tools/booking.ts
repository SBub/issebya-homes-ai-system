import { tool } from "ai";
import { z } from "zod";
import { flushTracing } from "@/instrumentation";
import { steppedSpan, type TraceAnchor } from "@/lib/tracing";
import { type HitlDecision, requestApprovalGate, resolveToolApproval } from "./approval-gate";
import type { ToolContext } from "./config";

// TODO: this trusts the model already called checkAvailability and got
// "available" — it does not independently re-verify before creating the
// link. The model can confidently answer an availability question without
// ever calling checkAvailability, so this could send a link for a room
// that's actually taken. Should defensively re-check against
// GET /api/availability?room= and return a structured error if unavailable.

// sendBookingLink is approve/reject-gated before the model ever sees a
// result, split into two halves per this app's run<ToolName> convention (see
// wants-human.ts's runWantsHuman/missing-info.ts's requestMissingInfoApproval
// for the model this follows): requestSendBookingLinkApproval below is the
// "calls human" half (creates the tool-call span, then reuses the generic,
// reusable approve/reject HITL mechanism in approval-gate.ts's
// requestApprovalGate — this tool genuinely IS approve/reject-shaped, unlike
// missing_info), runSendBookingLink is the "tool call" half — the pure
// URL-building logic, unchanged, run only once requestSendBookingLinkApproval
// has resolved `approved: true`. run-turn.ts's dispatchGatedToolCall glues
// the two together and patches the tool-call span's real output — see that
// function's own comment.

const sendBookingLinkSchema = z.object({
  guestName: z.string().describe("Guest full name"),
  email: z.string().email().describe("Guest email address"),
  room: z.enum(["room1", "room2"]).describe("Room they want to book"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runSendBookingLink below by name, after its own APPROVAL_GATES check has
// approved the call.
export const sendBookingLink = tool({
  description:
    "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name and email first if not known.",
  inputSchema: sendBookingLinkSchema,
});

// The event a suspended requestApprovalGate wait resolves on, and that
// handleBookingLinkApprovalReceived below sends — shared as a constant so the
// two ends can't drift apart, same reasoning as missing-info.ts's
// OWNER_NUDGE_ANSWERED_EVENT. Exported for tests/agent/tools/booking.test.ts.
export const BOOKING_LINK_APPROVAL_EVENT = "gca/booking-link.approval";

// Inngest's step.waitForEvent requires a bounded `timeout` string (see
// approval-gate.ts's requestApprovalGate doc comment for the full
// constraint). The app owner wants this wait to effectively never time out —
// the owner must be able to approve/reject whenever they get to it, not lose
// the request after a fixed window like missing_info's 24h. "52w" (~1 year)
// is the longest practical stand-in for "forever" this constraint allows.
// Not exported — only used within this file's own requestSendBookingLinkApproval.
const BOOKING_LINK_APPROVAL_TIMEOUT = "52w";

// Renders an ISO YYYY-MM-DD date as European DD-MM-YYYY for human display —
// the owner-facing Telegram nudge text, never the tool's own args/URL, which
// stay ISO (checkIn/checkOut round-trip through checkAvailability and the
// booking URL as YYYY-MM-DD, unaffected by this).
function toEuropeanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}-${month}-${year}` : isoDate;
}

// Human-readable reason string for the owner to see in Telegram — the nudge
// text itself, not re-parsed downstream (see telegram-router's owner-nudges
// route, which composes the approve/reject message straight from this
// string). Dates rendered European-style for display. Called by
// run-turn.ts's APPROVAL_GATES table (buildReason) before the gate
// dispatches the nudge — this file doesn't send the nudge itself.
export function buildBookingApprovalReason(args: z.infer<typeof sendBookingLinkSchema>): string {
  const { guestName, room, checkIn, checkOut } = args;
  return `${guestName} wants to book ${room} from ${toEuropeanDate(checkIn)} to ${toEuropeanDate(checkOut)}.`;
}

// Path+query shape of the URL built below, factored out as a shared
// constant so braintrust-scorers/hitl-compliance.scorer.ts's
// bypass-detection logic (a booking-shaped link reaching the guest with no
// real sendBookingLink execution span behind it) derives from this file's
// real format instead of a hand-guessed copy elsewhere. Domain-agnostic on
// purpose — siteUrl varies by env — so it matches on the
// `/booking/{room}?checkIn=...&checkOut=...` path+query shape only. Room is
// a path segment (the site's real route is `/booking/[type]`, not a `room=`
// query param) — keep this in sync with the template literal in
// runSendBookingLink below if that format ever changes.
export const BOOKING_LINK_URL_PATTERN =
  /\/booking\/(?:room1|room2)\?checkIn=\d{4}-\d{2}-\d{2}&checkOut=\d{4}-\d{2}-\d{2}/;

// send_booking_link's "calls human" half: creates the real
// gen_ai.tool.send_booking_link execution span FIRST — before
// requestApprovalGate ever runs — with the model's real tool-call `input`
// set at creation, same shape wants-human.ts's own runWantsHuman/
// missing-info.ts's own requestMissingInfoApproval give their own tool
// spans. Only `fn`'s return value (the real OTel-generated span id) survives
// this step — no live Span object survives an Inngest step boundary. That id
// becomes a new toolAnchor, passed to requestApprovalGate as its own
// traceAnchor param, so the nudge/decision/timeout spans requestApprovalGate
// creates internally become this tool-call span's real children instead of
// siblings of the turn's own anchor.
//
// Deliberately does NOT execute the tool or patch the span's output — the
// caller (run-turn.ts's loop, via run-tool.ts's runTool) does that once it
// has this function's HitlDecision, same split missing-info.ts's
// requestMissingInfoApproval/runMissingInfo already has. `payload` is left
// undefined (the default) — unlike missing_info's answer, the model's own
// `call.input` already has everything runSendBookingLink needs, nothing
// extra to hand forward.
export async function requestSendBookingLinkApproval(
  call: { toolName: string; input: Record<string, unknown> },
  correlationId: string,
  context: ToolContext,
): Promise<HitlDecision> {
  const { conversationId, phone, step, traceAnchor } = context;

  const toolSpanId = await steppedSpan(
    step,
    `tool-${call.toolName}`,
    traceAnchor,
    `gen_ai.tool.${call.toolName}`,
    {
      "gen_ai.tool.name": call.toolName,
      "gen_ai.operation.name": "execute_tool",
      "gca.tool.input": JSON.stringify(call.input),
      "braintrust.input": JSON.stringify(call.input),
    },
    async (span) => span.spanContext().spanId,
  );
  // Synchronous, awaited flush (not the routes' non-blocking after()) —
  // guarantees this span's own OTel export lands before the caller's own
  // later updateSpanIO patch can fire and race it. See wants-human.ts's own
  // runWantsHuman's identical flushTracing() call for the full reasoning.
  await flushTracing();
  const toolAnchor: TraceAnchor = { traceId: traceAnchor.traceId, spanId: toolSpanId };

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
    traceAnchor: toolAnchor,
    // The model's own real tool-call args — captured on this call's
    // pending_owner_decisions row (see requestApprovalGate's own `context`
    // param) so a later manual-resolve action can rebuild what this call
    // would have done (room/checkIn/checkOut) without re-parsing
    // buildBookingApprovalReason's human-readable prose.
    context: call.input,
  });

  // requestApprovalGate itself doesn't distinguish a rejection from a
  // timeout in its return value (both resolve `approved: false` — see its
  // own doc comment), so neither does this: same not-approved shape the
  // model has always seen on either exit path.
  if (!approved) {
    return {
      approved: false,
      notApprovedOutput: {
        approved: false,
        message: "This action was not approved. Do not retry it automatically.",
      },
      toolSpanId,
      toolAnchor,
    };
  }

  return { approved: true, toolSpanId, toolAnchor };
}

// Pure URL builder — no nudge, no suspend/wait. By the time run-turn.ts calls
// this, requestSendBookingLinkApproval above (backed by approval-gate.ts's
// requestApprovalGate) has already run and approved the call. Takes the
// guest's phone from ToolContext (already known — it's the WhatsApp
// conversation's own number) so the website booking form can prefill it
// instead of asking the guest to type it again.
export async function runSendBookingLink(
  args: z.infer<typeof sendBookingLinkSchema>,
  context: { phone: string },
) {
  const { guestName, email, room, checkIn, checkOut } = args;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const url = `${siteUrl}/booking/${room}?checkIn=${checkIn}&checkOut=${checkOut}&phone=${encodeURIComponent(context.phone)}&guestName=${encodeURIComponent(guestName)}&email=${encodeURIComponent(email)}&source=gca`;
  return { url };
}

// Thin wrapper around approval-gate.ts's generic resolveToolApproval, kept
// under this existing name so
// src/app/api/owner-nudges/[correlationId]/approve/route.ts (which imports
// handleBookingLinkApprovalReceived by name) doesn't need to change at all.
// correlationId comes straight from the Telegram button's callback_data (see
// apps/telegram-router's webhook route/owner-nudges route) — no DB lookup
// involved, and unlike missing_info's reply handler there's no KB/embedding
// write on this branch: the event just carries a plain approved boolean.
export async function handleBookingLinkApprovalReceived(params: {
  correlationId: string;
  approved: boolean;
}): Promise<void> {
  await resolveToolApproval({ event: BOOKING_LINK_APPROVAL_EVENT, ...params });
}
