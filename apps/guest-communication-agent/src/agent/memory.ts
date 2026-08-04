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

// Combines recent-message loading + token-budget trimming (reuses
// context.ts's trimToTokenBudget, only correlating its output back to
// message ids here) + CRM past-stay facts + a persistent rolling
// conversation summary backed by guest_memory.
//
// `.chat(MODEL)` and MODEL are duplicated locally rather than imported from
// run-turn.ts, since run-turn.ts imports loadMemory from here — importing
// back would create a circular import.
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

// Builds the plain-text content the prompt template wraps in
// <guest_memory> ({guest_memory_block}). Two labeled sections when both
// exist, one when only one does, fallback text when neither does.
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

  // trimToTokenBudget only ever peels messages off the front (oldest first),
  // so `rows`/`mapped` stay the same length/order and the dropped rows are
  // positionally rows.slice(0, droppedCount) — correlated by index, not id.
  const droppedCount = mapped.length - historyMessages.length;
  const droppedRows = rows.slice(0, droppedCount);

  // Find the existing summary's watermark within this turn's fetched rows.
  // Not found (no watermark, or it's aged out of the fetched window) means
  // every dropped row is new; found at index w means only rows after w are.
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
