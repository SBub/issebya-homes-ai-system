import { lookupGuestContact } from "./crm";
import { createAdminClient } from "./supabase";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/lib/db.ts (import path updated: that
// repo's @issebya/shared/supabase -> this repo's inlined ./supabase). Both
// are pure Postgres queries via createAdminClient(), no other deps.
// Postgres remains the system of record for conversation history/context;
// the agent loads that context itself, in loadContext (see
// ../agent/load-context.ts) — the caller only supplies
// conversationId/phone/incomingMessage, it doesn't pre-assemble history.
//
// Note: loadGuestMemory (guest_memory.summary lookup) was intentionally
// removed from here (in the source) — no writer anywhere in the codebase
// ever populates guest_memory, so it always returned empty. Worth
// revisiting once a summarizer exists to actually populate it.
//
// loadCrmContext (the crm_messages/campaigns/promo_codes join) was also
// removed in the source. It existed to synthesize a "you were sent campaign
// X, code Y" text block because campaign sends weren't otherwise visible
// anywhere. Now that campaign sends are logged into whatsapp_messages like
// any other assistant turn, that context shows up naturally in
// loadRecentMessages below — no synthetic block needed. Only the past-stay
// lookup (loadGuestInfo) survives, as its own function.

const RECENT_MESSAGE_LIMIT = 15;

interface MessageRow {
  role: "user" | "assistant";
  content: string;
}

// Fetches the most recent RECENT_MESSAGE_LIMIT messages for a conversation,
// returned oldest-first so callers can convert them straight into a
// chronologically-ordered LangChain message list (see ../agent/load-context.ts
// for why ordering matters here). Must query `created_at DESC` + `limit` to
// actually get the tail end of a long conversation, then reverse back to
// ascending order — querying ascending+limit (an earlier version of this
// function did) gives the OLDEST messages instead, which silently drops
// exactly the recent context this function exists to provide once a
// conversation grows past the limit.
export async function loadRecentMessages(
  conversationId: string,
  limit = RECENT_MESSAGE_LIMIT,
): Promise<MessageRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? [])
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }))
    .reverse();
}

// Looks up this guest's past-stay facts, unconditionally for any known
// phone — decoupled from whether a CRM campaign was ever sent (that
// coupling is what loadCrmContext used to bake in). Deliberately limited to
// past-stay facts (room/check-in/total stays); free-text
// preferences/summary memory is out of scope here (see guest_memory note
// above — still unpopulated, still a future concern, not this one).
//
// Data now comes from CRM (apps/crm), not a direct Supabase query — CRM
// owns the guest_contacts table (see src/lib/crm.ts's lookupGuestContact,
// which normalizes `phone` and is resilient to CRM being unreachable,
// returning null rather than throwing). The interpretation/formatting logic
// below is unchanged from when this queried guest_contacts directly:
//
// Returns null when there's no guest_contacts row for the phone at all, OR
// when a row exists but total_stays is 0 (a contact record with no actual
// completed stay yet — in practice guest_contacts is populated from the
// finance CSV import, one row per past *booking*, so this shouldn't occur
// from that path, but nothing enforces it at the DB level, and treating any
// existing row as "has stayed before" regardless of total_stays produced a
// real, confirmed bug: a guest with total_stays=0 was told "This guest has
// stayed with us before — most recently (0 stay(s) total)," which is false
// and reads as broken. Both are now the same "no info" case.
export async function loadGuestInfo(phone: string): Promise<string | null> {
  const contact = await lookupGuestContact(phone);
  if (!contact?.found || contact.total_stays <= 0) return null;

  const roomLine = contact.last_room
    ? ` in ${contact.last_room}${
        contact.last_stay_checkin ? `, checking in ${contact.last_stay_checkin}` : ""
      }`
    : "";

  return `This guest has stayed with us before — most recently${roomLine} (${contact.total_stays} stay(s) total).`;
}
