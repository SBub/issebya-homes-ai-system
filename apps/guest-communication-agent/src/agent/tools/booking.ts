import { tool } from "ai";
import { z } from "zod";
import { resolveToolApproval } from "./approval-gate";

// TODO: this trusts the model already called checkAvailability and got
// "available" — it does not independently re-verify before creating the
// link. The model can confidently answer an availability question without
// ever calling checkAvailability, so this could send a link for a room
// that's actually taken. Should defensively re-check against
// GET /api/availability?room= and return a structured error if unavailable.

// sendBookingLink is approve/reject-gated before the model ever sees a
// result — the real Telegram-nudge-then-suspend HITL mechanism lives in the
// generic, reusable approval-gate.ts (see that file's module comment), and
// the decision of WHETHER this tool needs approval (plus which event/timeout
// it uses) is made visible in run-turn.ts's APPROVAL_GATES table, not hidden
// in this file. By the time runSendBookingLink below is ever called, the
// gate has already run and approved the call — this file is left with only
// the parts that are genuinely booking-specific: the tool's schema, the
// human-readable approval-reason text, the event/timeout policy constants,
// and the actual URL-building logic.

const sendBookingLinkSchema = z.object({
  guestName: z.string().describe("Guest full name"),
  room: z.enum(["room1", "room2"]).describe("Room they want to book"),
  checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
  checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
});

// Schema-only declaration (no `execute`) — run-turn.ts dispatches to
// runSendBookingLink below by name, after its own APPROVAL_GATES check has
// approved the call.
export const sendBookingLink = tool({
  description:
    "Send a booking link to the guest. Call this when the guest has confirmed they want to book a specific room and dates. Collect their name first if not known.",
  inputSchema: sendBookingLinkSchema,
});

// The event a suspended run-turn.ts approval-gate wait resolves on, and that
// handleBookingLinkApprovalReceived below sends — shared as a constant so the
// two ends can't drift apart, same reasoning as missing-info.ts's
// OWNER_NUDGE_ANSWERED_EVENT. Exported for run-turn.ts's APPROVAL_GATES
// table — the gate's caller, not this file, is what actually waits on it
// (see approval-gate.ts's requestApprovalGate).
export const BOOKING_LINK_APPROVAL_EVENT = "gca/booking-link.approval";

// Inngest's step.waitForEvent requires a bounded `timeout` string (see
// approval-gate.ts's requestApprovalGate doc comment for the full
// constraint). The app owner wants this wait to effectively never time out —
// the owner must be able to approve/reject whenever they get to it, not lose
// the request after a fixed window like missing_info's 24h. "52w" (~1 year)
// is the longest practical stand-in for "forever" this constraint allows.
// Exported for run-turn.ts's APPROVAL_GATES table — still a booking-specific
// policy value, just consumed by the runtime dispatch loop instead of used
// internally here.
export const BOOKING_LINK_APPROVAL_TIMEOUT = "52w";

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
// `/booking?room=...&checkIn=...&checkOut=...` path+query shape only. Keep
// this in sync with the template literal in runSendBookingLink below if
// that format ever changes.
export const BOOKING_LINK_URL_PATTERN =
  /\/booking\?room=(?:room1|room2)&checkIn=\d{4}-\d{2}-\d{2}&checkOut=\d{4}-\d{2}-\d{2}/;

// Pure URL builder — no nudge, no suspend/wait, no ToolContext. By the time
// run-turn.ts calls this, its own APPROVAL_GATES check (backed by
// approval-gate.ts's requestApprovalGate) has already run and approved the
// call.
export async function runSendBookingLink(args: z.infer<typeof sendBookingLinkSchema>) {
  const { room, checkIn, checkOut } = args;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://issebya.com";
  const url = `${siteUrl}/booking?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`;
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
