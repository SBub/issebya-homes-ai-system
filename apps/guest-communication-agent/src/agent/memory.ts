import type { Span } from "@opentelemetry/api";
import { generateText, type ModelMessage } from "ai";
import { loadPrompt } from "braintrust";
import { trimToTokenBudget } from "@/agent/context";
import {
  advanceGuestMemoryWatermark,
  deleteGuestMemoryFold,
  getGuestMemory,
  insertGuestMemoryFold,
  loadGuestMemoryFolds,
  loadRecentMessages,
  type MessageRow,
  updateGuestMemoryPreferences,
} from "@/lib/db";
import { openrouter } from "@/lib/openrouter";
import { type TraceAnchor, withTurnSpan } from "@/lib/tracing";

// Combines recent-message loading + token-budget trimming (reuses
// context.ts's trimToTokenBudget, only correlating its output back to
// message ids here) + a persistent rolling conversation summary backed by
// guest_memory.
//
// Split into two entry points on purpose: loadMemory (the fast path, called
// at the start of every turn to build that turn's own system prompt) never
// calls the summarizer LLM or writes to guest_memory — it only reads
// whatever summary is already stored, up to one turn stale by design.
// foldMemory (the fold path, called by run-turn.ts's runGuestTurn AFTER the
// guest already has their reply) does the actual summarize-and-persist side
// effect. This keeps the summarizer's own LLM round-trip (24-43s in real
// traces) off the guest's reply-latency critical path.
//
// `.chat(MODEL)` and MODEL are duplicated locally rather than imported from
// run-turn.ts, since run-turn.ts imports from here — importing back would
// create a circular import.
const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

// This prompt lives in Braintrust (project BRAINTRUST_PROJECT_ID, slug
// below), like run-turn.ts's system prompt — but pinned to a fixed version
// id by default here, unlike that one (which defaults to the slug's latest
// saved version; see run-turn.ts's SYSTEM_PROMPT_SLUG comment for the full
// loadPrompt() version/environment behavior).
// SUMMARIZER_PROMPT_VERSION_OVERRIDE can override the pinned id, e.g. for
// testing against a draft version.
const SUMMARIZER_PROMPT_SLUG = "conversation-summarizer";
const SUMMARIZER_PROMPT_VERSION =
  process.env.SUMMARIZER_PROMPT_VERSION_OVERRIDE ?? "1000197705120199208";

// Distinct prompt, distinct job from SUMMARIZER_PROMPT above — see
// distillFoldIntoPreferences below. Newly created directly in Braintrust
// (no live callers yet at creation time, so unlike SUMMARIZER_PROMPT it
// never needed a stage-and-wait for human sign-off), same
// pin-by-default/override convention as SUMMARIZER_PROMPT_VERSION.
const DISTILLER_PROMPT_SLUG = "guest-preferences-distiller";
const DISTILLER_PROMPT_VERSION =
  process.env.DISTILLER_PROMPT_VERSION_OVERRIDE ?? "1000197705362702039";

// Second piece of the tiered-memory redesign (see
// 20260817120000_create_guest_memory_folds.sql's own comment for the first):
// once a guest has more than this many discrete guest_memory_folds rows, the
// oldest excess row(s) get distilled into guest_memory.preferences_summary
// and deleted — see maintainFoldWindow below. Exactly 2, not "2-3" — a named
// constant so that exactness survives future edits, same convention as
// context.ts's MAX_CONTEXT_TOKENS/KEEP_CONTEXT_TOKENS.
const MAX_RECENT_FOLDS = 2;

export interface AgentMemory {
  // Trimmed recent messages — the actual conversation, verbatim.
  historyMessages: ModelMessage[];
  // The rolling summary — fills the prompt template's {guest_memory_block}
  // variable directly.
  contextBlock: string;
}

// Matches any http(s) URL, not just this app's own booking-link shape or
// Google Maps — real messages have measured a 2-URL message alone costing
// 231 tokens (real tokenizer). The surrounding natural-language text (e.g.
// "Here's your booking link for Room 1, September 18-20:") already carries
// the useful signal — the model needs to know a link was sent, not its
// bytes — so URLs are replaced with this placeholder rather than dropped,
// keeping the rest of the sentence intact. Storage (recordMessage) and the
// guest's own WhatsApp replies never go through this function, so real
// links still reach Postgres and the guest untouched.
// Trailing-punctuation-excluding tail (`[^\s.,!?;:)\]}'"]`) so a URL
// embedded in a sentence — "...see you soon: https://maps.app.goo.gl/xyz."
// — doesn't swallow the sentence's own closing punctuation into the match.
const URL_PATTERN = /https?:\/\/\S*[^\s.,!?;:)\]}'"]/g;
const URL_PLACEHOLDER = "[link]";

function redactUrls(content: string): string {
  return content.replace(URL_PATTERN, URL_PLACEHOLDER);
}

function toModelMessage(row: MessageRow): ModelMessage {
  const content = redactUrls(row.content);
  return row.role === "user" ? { role: "user", content } : { role: "assistant", content };
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
  turnAnchor: TraceAnchor,
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

  // Cast needed: build()'s messages are typed as OpenAI-shaped chat
  // params (content can be a content-part array, for image/tool
  // messages), while generateText wants ModelMessage. SUMMARIZER_PROMPT
  // (see the migration script) only ever has plain-string system/user
  // content, so the two shapes coincide here even though their types
  // don't structurally align.
  async function generateSummaryText(span: Span): Promise<string> {
    const result = await generateText({ model, messages: messages as ModelMessage[] });

    span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
    // Same braintrust.* duplication as run-turn.ts's modelTurn (same
    // gen_ai.chat-shaped span wrapping pattern as here) — see tracing.ts's
    // withTurnSpan doc comment for why.
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
  }

  // Not inside any step.run() of its own — but it's only ever called from
  // foldMemory, which itself runs inside run-turn.ts's outer
  // step.run("fold-memory-summary", ...), so (like the model-call/tool-call
  // step.run wrapping in run-turn.ts) it only actually executes once per
  // real run; a replay returns the memoized fold-memory-summary result
  // without re-running this. Safe to wrap in a span for the same reason.
  return withTurnSpan(
    turnAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    generateSummaryText,
  );
}

// Builds the plain-text content the prompt template wraps in
// <guest_memory> ({guest_memory_block}). The summary section when it
// exists, fallback text when it doesn't.
export function buildContextBlock(summary: string | null): string {
  if (!summary) return "No prior guest information available.";
  return `Summary of earlier conversation:\n${summary}`;
}

// Shared by loadMemory and foldMemory below: fetches recent messages + the
// existing guest_memory row, trims to the token budget, and correlates the
// trimmed-off rows against the existing summary's watermark. Each caller
// re-runs this fresh against Postgres rather than sharing one read — by the
// time foldMemory runs, run-turn.ts's record-reply step has already written
// this turn's own assistant reply, so re-reading here is what lets the
// watermark computation see it too.
async function loadMemoryState(
  conversationId: string,
  phone: string,
): Promise<{
  historyMessages: ModelMessage[];
  existingMemory: Awaited<ReturnType<typeof getGuestMemory>>;
  newlyDroppedRows: MessageRow[];
}> {
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

  return { historyMessages, existingMemory, newlyDroppedRows };
}

// The fast path — called at the start of every turn. No LLM call, no DB
// write: contextBlock reads whatever summary guest_memory already has, which
// is up to one turn stale since a same-turn fold (see foldMemory below)
// hasn't run yet when this is called. That staleness is spec'd, not a bug —
// see this file's top comment.
export async function loadMemory(params: {
  conversationId: string;
  phone: string;
}): Promise<AgentMemory> {
  const { conversationId, phone } = params;
  const { historyMessages, existingMemory } = await loadMemoryState(conversationId, phone);

  return {
    historyMessages,
    contextBlock: buildContextBlock(existingMemory?.summary ?? null),
  };
}

// Distills one retiring guest_memory_folds row's summary text, plus
// whatever durable preferences guest_memory.preferences_summary already
// holds, into the updated preferences text — the durable, standing facts
// only (name, stated preferences, recurring requests), never the
// episodic/time-bound content that's retiring along with the fold row
// itself. See DISTILLER_PROMPT_SLUG's own comment for why this is a
// distinct prompt from SUMMARIZER_PROMPT rather than a reuse.
async function distillFoldIntoPreferences(
  foldSummaryText: string,
  priorPreferences: string,
  traceAnchor: TraceAnchor,
): Promise<string> {
  const promptTemplate = await loadPrompt({
    projectId: process.env.BRAINTRUST_PROJECT_ID,
    slug: DISTILLER_PROMPT_SLUG,
    version: DISTILLER_PROMPT_VERSION,
  });
  const { messages } = promptTemplate.build({
    prior_preferences: priorPreferences || "(none)",
    fold_summary: foldSummaryText,
  });

  // Same cast rationale as summarizeConversation's generateSummaryText
  // above: build()'s messages are OpenAI-shaped chat params, generateText
  // wants ModelMessage, and DISTILLER_PROMPT only ever has plain-string
  // system/user content so the shapes coincide in practice.
  async function generateDistilledText(span: Span): Promise<string> {
    const result = await generateText({ model, messages: messages as ModelMessage[] });

    span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
    span.setAttribute("braintrust.input", JSON.stringify(messages));
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
  }

  // Same safety-to-span reasoning as summarizeConversation's own comment:
  // only ever called from maintainFoldWindow, which is only ever called
  // from foldMemory — itself already off the guest reply's critical path
  // and inside run-turn.ts's outer step.run("fold-memory-summary", ...), so
  // this only actually executes once per real run.
  return withTurnSpan(
    traceAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    generateDistilledText,
  );
}

// Enforces MAX_RECENT_FOLDS: re-reads every guest_memory_folds row for this
// phone fresh from Postgres (not passed state from foldMemory — makes this
// self-correcting regardless of whether this event's own writeDiscreteFold
// insert actually landed, per foldMemory's call site comment below), and
// while there are more than MAX_RECENT_FOLDS rows, distills the single
// oldest one into guest_memory.preferences_summary and deletes it. Loops
// (rather than handling only the common single-new-fold case) so this stays
// correct even if more than one row is ever excess at once, e.g. a backfill.
// Each iteration feeds the freshly-updated preferences text into the next
// iteration's distillation call, not a stale pre-loop read.
async function maintainFoldWindow(phone: string, traceAnchor: TraceAnchor): Promise<void> {
  let folds = await loadGuestMemoryFolds(phone);
  while (folds.length > MAX_RECENT_FOLDS) {
    const oldest = folds[0];
    const existingMemory = await getGuestMemory(phone);
    const priorPreferences = existingMemory?.preferencesSummary ?? "";

    const updatedPreferences = await distillFoldIntoPreferences(
      oldest.summaryText,
      priorPreferences,
      traceAnchor,
    );
    await updateGuestMemoryPreferences(phone, updatedPreferences);
    await deleteGuestMemoryFold(oldest.id);

    folds = folds.slice(1);
  }
}

// The fold path — today's actual summarize-and-persist side effect,
// unchanged in its own logic (see loadMemoryState above), just no longer
// inline on the turn's critical path. Called from run-turn.ts's
// "fold-memory-summary" step, after the guest already has their reply. A
// cheap no-op (no LLM call, no write) when nothing new has dropped out of
// the trimmed window since the last fold — same self-throttling the inline
// version always had.
export async function foldMemory(params: {
  conversationId: string;
  phone: string;
  traceAnchor: TraceAnchor;
}): Promise<void> {
  const { conversationId, phone, traceAnchor } = params;
  const { newlyDroppedRows } = await loadMemoryState(conversationId, phone);
  if (newlyDroppedRows.length === 0) return;

  const newlyDroppedMessages = newlyDroppedRows.map(toModelMessage);
  const oldestDroppedId = newlyDroppedRows[0].id;
  const newWatermark = newlyDroppedRows[newlyDroppedRows.length - 1].id;

  // The discrete-fold-row write (guest_memory_folds — first piece of the
  // tiered-memory redesign, see 20260817120000_create_guest_memory_folds.sql).
  // prior_summary is always "" here: this row must only ever reflect
  // newlyDroppedMessages standing alone, never blended with prior
  // accumulated summary text, or it reproduces the same re-compression/
  // fidelity-loss problem this table exists to move away from. A failure
  // here must not affect advanceGuestMemoryWatermark's write below, since
  // the watermark must keep advancing regardless — it's caught here rather
  // than left to reject the surrounding Promise.all, and is no worse than a
  // fold not having happened for this table (recoverable next fold).
  async function writeDiscreteFold(): Promise<void> {
    try {
      const summaryText = await summarizeConversation(newlyDroppedMessages, "", traceAnchor);
      await insertGuestMemoryFold({
        phoneNumber: phone,
        summaryText,
        messageIdFrom: oldestDroppedId,
        messageIdTo: newWatermark,
      });
    } catch (err) {
      console.error(`[memory] guest_memory_folds write failed for phone ${phone}:`, err);
    }
  }

  await Promise.all([writeDiscreteFold(), advanceGuestMemoryWatermark(phone, newWatermark)]);

  // Sequenced after, not concurrent with, the two writes above: avoids
  // racing on guest_memory_folds' current row count, and guarantees
  // advanceGuestMemoryWatermark's upsert has already created/updated the
  // guest_memory row before maintainFoldWindow's .update() might need it.
  // Runs regardless of whether writeDiscreteFold above itself succeeded —
  // maintainFoldWindow re-reads real current state from the DB each time,
  // so it's self-correcting either way. Isolated in its own try/catch for
  // the same reason as writeDiscreteFold's: a distillation failure must
  // not affect the two writes above, which already succeeded by this
  // point — no worse than a fold window cleanup not having happened yet
  // (recoverable next fold).
  try {
    await maintainFoldWindow(phone, traceAnchor);
  } catch (err) {
    console.error(`[memory] maintainFoldWindow failed for phone ${phone}:`, err);
  }
}
