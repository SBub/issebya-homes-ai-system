import { generateText, type ModelMessage } from "ai";
import { loadPrompt } from "braintrust";
import { trimToTokenBudget } from "@/agent/context";
import { getGuestMemory, loadRecentMessages, type MessageRow, upsertGuestMemory } from "@/lib/db";
import { openrouter } from "@/lib/openrouter";
import { withTurnSpan } from "@/lib/tracing";

// Combines recent-message loading + token-budget trimming (reuses
// context.ts's trimToTokenBudget, only correlating its output back to
// message ids here) + a persistent rolling conversation summary backed by
// guest_memory.
//
// `.chat(MODEL)` and MODEL are duplicated locally rather than imported from
// run-turn.ts, since run-turn.ts imports loadMemory from here — importing
// back would create a circular import.
const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

// This prompt lives in Braintrust (project BRAINTRUST_PROJECT_ID, slug
// below) — same version-pinning rationale as run-turn.ts's
// SYSTEM_PROMPT_VERSION (that file's comment on it has the full explanation
// of why it's pinned rather than loadPrompt({ environment: "production" })).
const SUMMARIZER_PROMPT_SLUG = "conversation-summarizer";
const SUMMARIZER_PROMPT_VERSION =
  process.env.SUMMARIZER_PROMPT_VERSION_OVERRIDE ?? "1000197636062690373";

export interface AgentMemory {
  // Trimmed recent messages — the actual conversation, verbatim.
  historyMessages: ModelMessage[];
  // The rolling summary — fills the prompt template's {guest_memory_block}
  // variable directly, replacing the guestContext-only value run-turn.ts
  // used to build itself.
  contextBlock: string;
}

function toModelMessage(row: MessageRow): ModelMessage {
  return row.role === "user"
    ? { role: "user", content: row.content }
    : { role: "assistant", content: row.content };
}

// guest_memory.phone_number is keyed on the bare (non-"whatsapp:"-prefixed)
// form to match CRM's guest_contacts (apps/crm's normalizePhone). `phone`
// arrives here already normalized — the webhook route
// (src/app/api/webhook/whatsapp/route.ts) strips Twilio's "whatsapp:"
// prefix once, at the ingress boundary, before starting the turn — so the
// agent (this file included) never has to know that prefix exists.
async function summarizeConversation(
  newlyDroppedMessages: ModelMessage[],
  priorSummary: string,
  correlationId: string,
): Promise<string> {
  const transcript = newlyDroppedMessages
    .map(
      (m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n");

  const promptTemplate = await loadPrompt({
    projectId: process.env.BRAINTRUST_PROJECT_ID,
    slug: SUMMARIZER_PROMPT_SLUG,
    version: SUMMARIZER_PROMPT_VERSION,
  });
  const { messages } = promptTemplate.build({
    prior_summary: priorSummary || "(none)",
    transcript,
  });

  // Not inside any step.run() of its own — but it's only ever called from
  // loadMemory, which itself runs inside run-turn.ts's outer
  // step.run("load-memory", ...), so (like the model-call/tool-call
  // step.run wrapping in run-turn.ts) it only actually executes once per
  // real run; a replay returns the memoized load-memory result without
  // re-running this. Safe to wrap in a span for the same reason.
  return withTurnSpan(
    correlationId,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    async (span) => {
      // Cast needed: build()'s messages are typed as OpenAI-shaped chat
      // params (content can be a content-part array, for image/tool
      // messages), while generateText wants ModelMessage. SUMMARIZER_PROMPT
      // (see the migration script) only ever has plain-string system/user
      // content, so the two shapes coincide here even though their types
      // don't structurally align.
      const result = await generateText({ model, messages: messages as ModelMessage[] });

      span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
      // "braintrust.*" is the namespace that actually maps to a span's
      // top-level input/output fields in Braintrust's UI — see run-turn.ts's
      // modelTurn for the full explanation (same gen_ai.chat-shaped span
      // wrapping pattern as here).
      span.setAttribute("braintrust.input", JSON.stringify(messages));
      // Optional chaining throughout: `response`/`usage` are always present
      // on a real AI SDK generateText() result, but memory.test.ts's mock
      // returns a trimmed-down `{ text }`-only shape.
      if (result.response?.messages !== undefined) {
        span.setAttribute("gen_ai.output.messages", JSON.stringify(result.response.messages));
        span.setAttribute("braintrust.output", JSON.stringify(result.response.messages));
      }
      if (result.usage?.inputTokens !== undefined) {
        span.setAttribute("gen_ai.usage.input_tokens", result.usage.inputTokens);
      }
      if (result.usage?.outputTokens !== undefined) {
        span.setAttribute("gen_ai.usage.output_tokens", result.usage.outputTokens);
      }

      return result.text;
    },
  );
}

// Builds the plain-text content the prompt template wraps in
// <guest_memory> ({guest_memory_block}). The summary section when it
// exists, fallback text when it doesn't.
export function buildContextBlock(summary: string | null): string {
  if (!summary) return "No prior guest information available.";
  return `Summary of earlier conversation:\n${summary}`;
}

export async function loadMemory(params: {
  conversationId: string;
  phone: string;
  correlationId: string;
}): Promise<AgentMemory> {
  const { conversationId, phone, correlationId } = params;

  const [rows, existingMemory] = await Promise.all([
    loadRecentMessages(conversationId),
    getGuestMemory(phone),
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
    summary = await summarizeConversation(
      newlyDroppedMessages,
      existingMemory?.summary ?? "",
      correlationId,
    );

    const newWatermark = newlyDroppedRows[newlyDroppedRows.length - 1].id;
    await upsertGuestMemory(phone, summary, newWatermark);
  }

  return {
    historyMessages,
    contextBlock: buildContextBlock(summary),
  };
}
