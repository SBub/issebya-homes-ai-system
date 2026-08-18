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
  preferencesSummary: string | null;
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
      .select("summary, summarized_through_message_id, preferences_summary")
      .eq("phone_number", phone)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      summary: data.summary as string,
      summarizedThroughMessageId: (data.summarized_through_message_id as string | null) ?? null,
      preferencesSummary: (data.preferences_summary as string | null) ?? null,
    };
  });
}

// Advances only guest_memory.summarized_through_message_id — no summary
// text, no LLM call anywhere near this. A guest's very first-ever fold has
// no existing guest_memory row yet, so this upserts rather than updates;
// the payload lists only phone_number/summarized_through_message_id, and a
// Postgres upsert only overwrites the columns actually present in the
// payload, so an existing row's preferences_summary survives untouched on
// conflict — verified empirically against the real local Supabase stack,
// not assumed.
export async function advanceGuestMemoryWatermark(
  phone: string,
  summarizedThroughMessageId: string,
): Promise<void> {
  return withSpan("db.advanceGuestMemoryWatermark", { "db.table": "guest_memory" }, async () => {
    const supabase = createAdminClient();
    const { error } = await supabase.from("guest_memory").upsert(
      {
        phone_number: phone,
        summarized_through_message_id: summarizedThroughMessageId,
      },
      { onConflict: "phone_number" },
    );

    if (error) throw error;
  });
}

// Pure insert (not upsert, unlike advanceGuestMemoryWatermark above) — one
// row per fold event, not keyed/deduped by phone_number. Backs guest_memory_folds,
// the discrete-fold-row table (see 20260817120000_create_guest_memory_folds.sql
// and ../agent/memory.ts's foldMemory).
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

export interface GuestMemoryFoldRow {
  id: string;
  summaryText: string;
  messageIdFrom: string | null;
  messageIdTo: string | null;
  createdAt: string;
}

// Read side for guest_memory_folds — backs ../agent/memory.ts's
// maintainFoldWindow (the MAX_RECENT_FOLDS cap enforcement). Ordered
// oldest-first so the caller can find the row(s) to distill/delete via a
// plain array index (rows[0]) rather than re-sorting. The MAX_RECENT_FOLDS
// cap keeps this table at a handful of rows per phone at all times (2, or
// briefly 3 right after a new insert before maintainFoldWindow's cleanup
// runs) — no pagination/limit needed, this always fetches every row for the
// phone.
export async function loadGuestMemoryFolds(phone: string): Promise<GuestMemoryFoldRow[]> {
  return withSpan("db.loadGuestMemoryFolds", { "db.table": "guest_memory_folds" }, async () => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("guest_memory_folds")
      .select("id, summary_text, message_id_from, message_id_to, created_at")
      .eq("phone_number", phone)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id as string,
      summaryText: row.summary_text as string,
      messageIdFrom: (row.message_id_from as string | null) ?? null,
      messageIdTo: (row.message_id_to as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  });
}

// Deletes a single guest_memory_folds row by id — backs maintainFoldWindow's
// cleanup once a fold's contents have been distilled into
// guest_memory.preferences_summary (updateGuestMemoryPreferences below).
export async function deleteGuestMemoryFold(id: string): Promise<void> {
  return withSpan("db.deleteGuestMemoryFold", { "db.table": "guest_memory_folds" }, async () => {
    const supabase = createAdminClient();
    const { error } = await supabase.from("guest_memory_folds").delete().eq("id", id);

    if (error) throw error;
  });
}

// Updates only preferences_summary on an existing guest_memory row. Uses
// .update() rather than .upsert() (unlike advanceGuestMemoryWatermark above)
// deliberately — a guest_memory row is guaranteed to already exist by the
// time this is ever called (only ever called after foldMemory's own
// advanceGuestMemoryWatermark call has already created/updated that row in
// the same fold event).
export async function updateGuestMemoryPreferences(
  phone: string,
  preferencesSummary: string,
): Promise<void> {
  return withSpan("db.updateGuestMemoryPreferences", { "db.table": "guest_memory" }, async () => {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("guest_memory")
      .update({ preferences_summary: preferencesSummary })
      .eq("phone_number", phone);

    if (error) throw error;
  });
}
