import { createAdminClient } from "./supabase";
import { withSpan } from "./tracing";

// Pure Postgres queries via createAdminClient(). Context assembly itself
// lives in ../agent/memory.ts's loadMemory/foldMemory (both call these).

// Safety ceiling on the raw DB fetch only — not the real context-size
// limiter (that's trimToTokenBudget in ../agent/context.ts, applied
// downstream). Just stops pulling a guest's entire history in one round trip.
const RECENT_MESSAGE_SAFETY_LIMIT = 150;

export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// Returns up to `limit` most recent messages, oldest-first. Must query
// `created_at DESC` + `limit` then reverse — querying ascending+limit gives
// the OLDEST messages instead once a conversation exceeds the limit.
//
// Includes id/created_at (not just role/content) so memory.ts's
// loadMemoryState can correlate rows trimToTokenBudget drops back to their
// message ids, for guest_memory's summarized_through_message_id watermark
// (only foldMemory acts on that correlation; loadMemory ignores it).
export async function loadRecentMessages(
  conversationId: string,
  limit = RECENT_MESSAGE_SAFETY_LIMIT,
): Promise<MessageRow[]> {
  return withSpan(
    "db.loadRecentMessages",
    { "db.table": "whatsapp_messages", "gca.conversation_id": conversationId },
    async () => {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? [])
        .map((m) => ({
          id: m.id as string,
          role: m.role as "user" | "assistant",
          content: m.content as string,
          created_at: m.created_at as string,
        }))
        .reverse();
    },
  );
}

export interface GuestMemoryRow {
  summary: string;
  summarizedThroughMessageId: string | null;
}

// `phone` must already be normalized by the caller — this function does no
// normalization of its own. In practice that means the bare (non-
// "whatsapp:"-prefixed) form, stripped once at the webhook ingress boundary
// (src/app/api/webhook/whatsapp/route.ts) and threaded through unchanged.
// Returns null (not an empty row) when no guest_memory row exists yet —
// callers distinguish "no row" from "row with empty summary".
export async function getGuestMemory(phone: string): Promise<GuestMemoryRow | null> {
  return withSpan("db.getGuestMemory", { "db.table": "guest_memory" }, async () => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("guest_memory")
      .select("summary, summarized_through_message_id")
      .eq("phone_number", phone)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      summary: data.summary as string,
      summarizedThroughMessageId: (data.summarized_through_message_id as string | null) ?? null,
    };
  });
}

// `updated_at` is set explicitly — no set_updated_at/moddatetime trigger
// convention exists in this repo's migrations.
export async function upsertGuestMemory(
  phone: string,
  summary: string,
  summarizedThroughMessageId: string,
): Promise<void> {
  return withSpan("db.upsertGuestMemory", { "db.table": "guest_memory" }, async () => {
    const supabase = createAdminClient();
    const { error } = await supabase.from("guest_memory").upsert(
      {
        phone_number: phone,
        summary,
        summarized_through_message_id: summarizedThroughMessageId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" },
    );

    if (error) throw error;
  });
}

// Pure insert (not upsert, unlike upsertGuestMemory above) — one row per
// fold event, not keyed/deduped by phone_number. Backs guest_memory_folds,
// the discrete-fold-row table (see 20260817120000_create_guest_memory_folds.sql
// and ../agent/memory.ts's foldMemory). No read/list function for this table
// lives here yet — that belongs to whichever later task owns the read side.
export async function insertGuestMemoryFold(params: {
  phoneNumber: string;
  summaryText: string;
  messageIdFrom: string | null;
  messageIdTo: string | null;
}): Promise<void> {
  return withSpan("db.insertGuestMemoryFold", { "db.table": "guest_memory_folds" }, async () => {
    const supabase = createAdminClient();
    const { error } = await supabase.from("guest_memory_folds").insert({
      phone_number: params.phoneNumber,
      summary_text: params.summaryText,
      message_id_from: params.messageIdFrom,
      message_id_to: params.messageIdTo,
    });

    if (error) throw error;
  });
}
