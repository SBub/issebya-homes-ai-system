import { generateText, type ModelMessage } from "ai";
import { trimToTokenBudget } from "@/agent/context";
import {
  getGuestMemory,
  loadGuestInfo,
  loadRecentMessages,
  type MessageRow,
  upsertGuestMemory,
} from "@/lib/db";
import { openrouter } from "@/lib/openrouter";

// Supersedes load-context.ts (deleted — see this app's "no two mechanisms
// coexisting" precedent). Combines everything a turn needs to hydrate
// itself with: recent-message loading + token-budget trimming (reuses
// ../agent/context.ts's estimateTokens/trimToTokenBudget unchanged — this
// file does not duplicate that logic, only correlates its output back to
// message ids) + CRM past-stay facts + a NEW persistent rolling
// conversation summary backed by the guest_memory table (step 2 of the
// memory/context-hydration work — see TASK_FOR_TOMORROW.md; step 1, the
// token-budget trimming mechanics, already existed).
//
// `.chat(MODEL)` is built locally here (own openrouter client reference,
// own MODEL constant) rather than importing anything from run-turn.ts —
// run-turn.ts imports loadMemory from this file, so importing back from
// run-turn.ts would create a circular import. Duplicating the one MODEL
// string is simpler than extracting a shared constants file for it.
const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

export interface AgentMemory {
  // Trimmed recent messages — the actual conversation, verbatim.
  historyMessages: ModelMessage[];
  // CRM guest facts + rolling summary, combined — fills the prompt
  // template's {guest_memory_block} variable directly, replacing the
  // guestContext-only value run-turn.ts used to build itself.
  contextBlock: string;
}

function toModelMessage(row: MessageRow): ModelMessage {
  return row.role === "user"
    ? { role: "user", content: row.content }
    : { role: "assistant", content: row.content };
}

// Phone-key decision: the phone reaching loadMemory (traced webhook route
// -> runGuestTurnWorkflow -> runAgentTurn -> loadMemory) is Twilio's raw
// `From` field, always "whatsapp:+..." prefixed (see the webhook route's
// `params.From` and conversations.ts's getOrCreateActiveConversation,
// which stores whatsapp_conversations.phone_number in that same prefixed
// form). CRM's own guest_contacts table, by contrast, is keyed on the BARE
// form — apps/crm/src/lib/phone.ts's normalizePhone strips the
// "whatsapp:" prefix before CRM ever writes or queries a phone. GCA's
// lookupGuestContact (../lib/crm.ts) just forwards whatever form it's
// given and lets CRM normalize server-side, so it doesn't settle this for
// us. Since guest_memory and guest_contacts are conceptually about the
// same guest, this keys guest_memory.phone_number in that same bare form
// CRM normalizes to — a local mirror of normalizePhone, since apps/crm's
// module isn't importable across the app boundary.
function normalizeMemoryPhoneKey(phone: string): string {
  return phone.replace(/^whatsapp:/i, "").trim();
}

// Domain-tuned for GCA (a WhatsApp hospitality booking agent), not copied
// verbatim from harness-engineering/harness/memory.ts's summarize() (that
// reference's "item ids, categories, draft ids, amounts" instruction is
// dev-agent-flavored) — same terse "fold new content into prior summary"
// shape, different preserved facts.
async function summarizeConversation(
  newlyDroppedMessages: ModelMessage[],
  priorSummary: string,
): Promise<string> {
  const transcript = newlyDroppedMessages
    .map(
      (m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n");

  const { text } = await generateText({
    model,
    messages: [
      {
        role: "system",
        content:
          "You compress an older stretch of a WhatsApp guest conversation with a " +
          "vacation-rental booking agent into a short running summary. Preserve concrete " +
          "facts: the guest's name (if mentioned), rooms/dates discussed or booked, prices " +
          'quoted, promises or commitments made (e.g. "I\'ll check with the owner"), any ' +
          "prior escalations, and guest-stated preferences or facts. Be terse.",
      },
      {
        role: "user",
        content: `Prior summary:\n${priorSummary || "(none)"}\n\nFold in this older part of the conversation:\n${transcript}\n\nReturn the updated summary.`,
      },
    ],
  });

  return text;
}

// Combines CRM past-stay facts and the rolling summary into the single
// text block the prompt template wraps in <guest_memory> ({guest_memory_block}
// — the template owns that XML wrapper, this only builds the plain-text
// content). Two clearly labeled sections when both exist; just one when
// only one exists; the existing fallback text when neither does. Moved
// here from run-turn.ts, which used to inline
// `guestContext ?? "No prior guest information available."` — run-turn.ts
// no longer needs to know about that fallback.
export function buildContextBlock(guestFacts: string | null, summary: string | null): string {
  const sections: string[] = [];
  if (guestFacts) sections.push(`Guest facts:\n${guestFacts}`);
  if (summary) sections.push(`Summary of earlier conversation:\n${summary}`);

  if (sections.length === 0) return "No prior guest information available.";
  return sections.join("\n\n");
}

export async function loadMemory(params: {
  conversationId: string;
  phone: string;
}): Promise<AgentMemory> {
  const { conversationId, phone } = params;
  const memoryPhoneKey = normalizeMemoryPhoneKey(phone);

  const [rows, guestFacts, existingMemory] = await Promise.all([
    loadRecentMessages(conversationId),
    loadGuestInfo(phone),
    getGuestMemory(memoryPhoneKey),
  ]);

  const mapped = rows.map(toModelMessage);
  const historyMessages = trimToTokenBudget(mapped);

  // trimToTokenBudget only ever peels messages off the front (oldest
  // first) — see context.ts's own doc comment — so `rows` and `mapped` are
  // the same length and same chronological order, and the number dropped
  // is exactly the length difference. The oldest `droppedCount` rows are
  // therefore rows.slice(0, droppedCount).
  const droppedCount = mapped.length - historyMessages.length;
  const droppedRows = rows.slice(0, droppedCount);

  // Watermark check: find where the existing summary's
  // summarized_through_message_id sits within this turn's fetched rows
  // (still chronologically ordered, oldest-first, from loadRecentMessages).
  // Not found (no watermark yet, or the watermarked message has aged out of
  // the fetched window entirely — meaning it's older than everything fetched
  // here) means every dropped row is new. Found at index w means only rows
  // after index w are new — since droppedRows is rows.slice(0, droppedCount),
  // its indices line up 1:1 with rows' indices.
  const watermarkId = existingMemory?.summarizedThroughMessageId ?? null;
  const watermarkIndex = watermarkId ? rows.findIndex((r) => r.id === watermarkId) : -1;
  const newlyDroppedRows =
    watermarkIndex === -1 ? droppedRows : droppedRows.slice(watermarkIndex + 1);

  let summary = existingMemory?.summary ?? null;

  if (newlyDroppedRows.length > 0) {
    const newlyDroppedMessages = newlyDroppedRows.map(toModelMessage);
    summary = await summarizeConversation(newlyDroppedMessages, existingMemory?.summary ?? "");

    const newWatermark = newlyDroppedRows[newlyDroppedRows.length - 1].id;
    await upsertGuestMemory(memoryPhoneKey, summary, newWatermark);
  }

  return {
    historyMessages,
    contextBlock: buildContextBlock(guestFacts, summary),
  };
}
