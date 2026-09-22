import type { Span } from "@opentelemetry/api";
import { generateText, type JSONValue, type ModelMessage, type ToolResultPart } from "ai";
import { loadPrompt } from "braintrust";
import { trimToTokenBudget } from "@/agent/context";
import {
  advanceGuestMemoryWatermark,
  deleteGuestMemoryFold,
  type GuestMemoryFoldRow,
  getGuestMemory,
  insertGuestMemoryFold,
  loadGuestMemoryFolds,
  loadRecentMessages,
  type MessageRow,
  updateGuestMemoryPreferences,
} from "@/lib/db";
import { openrouter } from "@/lib/openrouter";
import { type TraceAnchor, withTurnSpan } from "@/lib/tracing";

// Recent-message loading + token-budget trimming (context.ts's
// trimToTokenBudget) plus a persistent rolling conversation summary backed
// by guest_memory.
//
// Two entry points on purpose: loadMemory (fast path, every turn) never
// calls the summarizer LLM or writes to guest_memory — it only reads
// whatever's already stored, up to one turn stale by design. foldMemory
// (called AFTER the guest has their reply) does the real summarize-and-persist
// work, keeping that LLM round-trip (24-43s in real traces) off the guest's
// reply-latency path.
//
// MODEL is duplicated locally (not imported from run-agent-turn.ts) to avoid
// a circular import — run-agent-turn.ts imports from this file.
const MODEL = "deepseek/deepseek-v4-pro";
const model = openrouter.chat(MODEL);

// Lives in Braintrust — see run-agent-turn.ts's SYSTEM_PROMPT_SLUG comment for the
// default-to-latest loadPrompt() behavior this shares.
const SUMMARIZER_PROMPT_SLUG = "conversation-summarizer";

// Distinct prompt/job from SUMMARIZER_PROMPT — see distillFoldIntoPreferences
// below.
const DISTILLER_PROMPT_SLUG = "guest-preferences-distiller";

// Once a guest has more than this many guest_memory_folds rows, the oldest
// excess gets distilled into guest_memory.preferences_summary and deleted —
// see maintainFoldWindow below.
const MAX_RECENT_FOLDS = 1;

export interface AgentMemory {
  historyMessages: ModelMessage[];
  // Prepended ahead of historyMessages in run-agent-turn.ts's `messages`, not
  // substituted into the system prompt. `null` (never a placeholder) when
  // there's nothing to say — see buildMemoryMessage.
  memoryMessage: ModelMessage | null;
}

// Matches any http(s) URL — a 2-URL message alone measured 231 tokens (real
// tokenizer). Replaced with a placeholder rather than dropped so the
// surrounding sentence stays intact; storage and the guest's own replies
// never go through this, so real links still reach Postgres/the guest.
const URL_PATTERN = /https?:\/\/\S*[^\s.,!?;:)\]}'"]/g;
const URL_PLACEHOLDER = "[link]";

// LANDMINE: never redact the most recent turns. The model reads its own
// history as-is — a redacted prior reply reads as "I already said [link]",
// and the model then reproduces that literal placeholder in a fresh reply
// instead of a real URL from that turn's own send_booking_link call
// (confirmed via real production traces). Redaction only exists to save
// tokens on messages old enough that exact recall no longer matters, so it
// must never touch the tail the model is actively working from. 8 covers
// the shortest real failure chain observed (real-link reply, a follow-up
// question, its answer, the guest's next booking confirmation — 4 rows)
// with headroom for a longer exchange before a repeat booking. Applied per
// turn group: every message in a group that touches one of these rows stays
// unredacted, including replayed tool results.
const RECENT_MESSAGES_KEPT_UNREDACTED = 8;

// How many of the most recent turn groups replay their stored turn_messages
// (tool calls and results) verbatim; older groups replay text only. Same
// default as Anthropic's clear_tool_uses (keeps 3) and the AI SDK's
// pruneMessages ("before-last-3-messages").
const VERBATIM_TURNS = 3;

function redactUrls(content: string): string {
  return content.replace(URL_PATTERN, URL_PLACEHOLDER);
}

function redactJson(value: JSONValue): JSONValue {
  if (typeof value === "string") return redactUrls(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, v === undefined ? v : redactJson(v)]),
    );
  }
  return value;
}

function redactToolResult(part: ToolResultPart): ToolResultPart {
  const { output } = part;
  switch (output.type) {
    case "text":
    case "error-text":
      return { ...part, output: { ...output, value: redactUrls(output.value) } };
    case "json":
    case "error-json":
      return { ...part, output: { ...output, value: redactJson(output.value) } };
    default:
      return part;
  }
}

// Tool-call inputs are left alone: they hold no URLs and are the facts.
function redactMessage(message: ModelMessage): ModelMessage {
  if (typeof message.content === "string") {
    return { ...message, content: redactUrls(message.content) } as ModelMessage;
  }
  if (message.role === "assistant") {
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "text" ? { ...part, text: redactUrls(part.text) } : part,
      ),
    };
  }
  if (message.role === "tool") {
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result" ? redactToolResult(part) : part,
      ),
    };
  }
  return message;
}

// Text-only: ignores turn_messages. Also the summariser's row mapper, so
// folds never receive tool JSON.
function toModelMessage(row: MessageRow, redact: boolean): ModelMessage {
  const content = redact ? redactUrls(row.content) : row.content;
  return row.role === "user" ? { role: "user", content } : { role: "assistant", content };
}

// A user row starts a group and the assistant rows after it join it.
// Leading assistant rows (possible right after the watermark) form their
// own group. Interleaving from a suspended turn (user1, user2,
// assistant(run2), assistant(run1)) is safe because each stored
// turn_messages array is self-contained (see turn-messages.ts).
function groupRowsByTurn(rows: MessageRow[]): MessageRow[][] {
  const groups: MessageRow[][] = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (row.role === "user" || current === undefined) {
      groups.push([row]);
    } else {
      current.push(row);
    }
  }
  return groups;
}

// Builds history from oldest-first rows, one ModelMessage[] per turn group,
// with rowGroups[i] the rows behind groups[i] so a caller can map trimmed
// groups back to message ids. replayTurnMessages: false forces text-only
// replay for every row; it exists only for the eval regression switch.
export function buildHistoryMessages(
  rows: MessageRow[],
  options?: { replayTurnMessages?: boolean },
): { groups: ModelMessage[][]; rowGroups: MessageRow[][] } {
  const replayTurnMessages = options?.replayTurnMessages ?? true;
  const rowGroups = groupRowsByTurn(rows);
  const unredactedFromIndex = rows.length - RECENT_MESSAGES_KEPT_UNREDACTED;

  let rowIndex = 0;
  const groups = rowGroups.map((groupRows, groupIndex) => {
    const groupEndIndex = rowIndex + groupRows.length - 1;
    rowIndex += groupRows.length;
    const redact = groupEndIndex < unredactedFromIndex;
    const verbatim = replayTurnMessages && rowGroups.length - groupIndex <= VERBATIM_TURNS;

    return groupRows.flatMap((row) => {
      const stored = verbatim && row.role === "assistant" ? row.turn_messages : null;
      if (stored === null) return [toModelMessage(row, redact)];
      return redact ? stored.messages.map(redactMessage) : stored.messages;
    });
  });

  return { groups, rowGroups };
}

// `phone` arrives already normalized (no "whatsapp:" prefix) — the webhook
// route strips that once, at ingress.
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

  // loadPrompt() runs inside this span callback (not before withTurnSpan
  // opens below) so a fetch failure lands inside an already-open span for
  // withTurnSpan's catch to record, instead of throwing before any span
  // exists.
  //
  // Cast: build()'s messages are OpenAI-shaped chat params; generateText
  // wants ModelMessage. SUMMARIZER_PROMPT only has plain-string content, so
  // the shapes coincide despite not aligning structurally.
  async function generateSummaryText(span: Span): Promise<string> {
    const promptTemplate = await loadPrompt({
      projectId: process.env.BRAINTRUST_PROJECT_ID,
      slug: SUMMARIZER_PROMPT_SLUG,
      defaults: { model: MODEL },
    });
    const { messages } = promptTemplate.build({
      prior_summary: priorSummary || "(none)",
      transcript,
    });

    const result = await generateText({ model, messages: messages as ModelMessage[] });

    span.setAttribute("gen_ai.input.messages", JSON.stringify(messages));
    // See tracing.ts's Braintrust-attribute-namespace comment for why.
    span.setAttribute("braintrust.input", JSON.stringify(messages));
    // Optional chaining: memory.test.ts's mock returns a trimmed `{ text }`-
    // only shape, unlike a real generateText() result.
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
    if (result.usage?.inputTokenDetails?.cacheReadTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_read.input_tokens",
        result.usage.inputTokenDetails.cacheReadTokens,
      );
    }
    if (result.usage?.inputTokenDetails?.cacheWriteTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_creation.input_tokens",
        result.usage.inputTokenDetails.cacheWriteTokens,
      );
    }

    return result.text;
  }

  // Not inside its own step.run — but only ever called from foldMemory,
  // itself inside run-guest-turn.ts's "fold-memory-summary" step.run, so this
  // only executes once per real run; safe to wrap in a span for the same
  // reason.
  return withTurnSpan(
    turnAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    generateSummaryText,
  );
}

// Kept as two labeled sections (durable preferences vs. the one recent
// fold) rather than flattened into one blob — losing that distinction
// defeats the point of splitting them in the first place.
//
// role: "assistant", not "system" — the AI SDK's runtime warning steers
// away from role: "system" entries inside `messages`, preferring the
// dedicated `system` parameter for the one true system prompt.
export function buildMemoryMessage(
  preferencesSummary: string | null,
  recentFold: GuestMemoryFoldRow | null,
): ModelMessage | null {
  const sections: string[] = [];

  if (preferencesSummary) {
    sections.push(`User preferences:\n${preferencesSummary}`);
  }
  if (recentFold) {
    sections.push(`Summary of earlier conversation:\n${recentFold.summaryText}`);
  }

  if (sections.length === 0) return null;
  return { role: "assistant", content: sections.join("\n\n") };
}

// LANDMINE: watermark filtering must happen BEFORE trimming, not after — a
// row already folded into guest_memory_folds must never also appear
// verbatim in historyMessages (even if it'd still fit under
// KEEP_CONTEXT_TOKENS), or the same content reaches the model both raw and
// as a summary simultaneously.
//
// Shared by loadMemory/foldMemory; each re-runs this fresh against Postgres
// rather than sharing one read, so foldMemory's later call sees this turn's
// own just-recorded reply too.
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

  // Not found (no watermark yet, or aged out of the fetched window) means
  // every fetched row is unfolded; found at index w means only rows after w
  // are.
  const watermarkId = existingMemory?.summarizedThroughMessageId ?? null;
  const watermarkIndex = watermarkId ? rows.findIndex((r) => r.id === watermarkId) : -1;
  const unfoldedRows = watermarkIndex === -1 ? rows : rows.slice(watermarkIndex + 1);

  const { groups, rowGroups } = buildHistoryMessages(unfoldedRows);
  const keptGroups = trimToTokenBudget(groups);
  const historyMessages = keptGroups.flat();

  // trimToTokenBudget only peels whole groups off the front (oldest first),
  // so the dropped rows are the rows of the first droppedGroupCount groups,
  // and the watermark always advances at a turn boundary.
  const droppedGroupCount = groups.length - keptGroups.length;
  const newlyDroppedRows = rowGroups.slice(0, droppedGroupCount).flat();

  return { historyMessages, existingMemory, newlyDroppedRows };
}

// The fast path. No LLM call, no DB write — memoryMessage is built from
// whatever already exists, up to one turn stale (spec'd, not a bug: a
// same-turn fold hasn't run yet when this is called). loadGuestMemoryFolds
// runs concurrently with loadMemoryState's own internal fetch, not after
// it, since this is on the guest's reply-latency path.
export async function loadMemory(params: {
  conversationId: string;
  phone: string;
}): Promise<AgentMemory> {
  const { conversationId, phone } = params;
  const [{ historyMessages, existingMemory }, recentFolds] = await Promise.all([
    loadMemoryState(conversationId, phone),
    loadGuestMemoryFolds(phone),
  ]);

  return {
    historyMessages,
    // MAX_RECENT_FOLDS caps this list at 0 or 1 entries.
    memoryMessage: buildMemoryMessage(
      existingMemory?.preferencesSummary ?? null,
      recentFolds[0] ?? null,
    ),
  };
}

// Distills one retiring fold's summary, plus existing durable preferences,
// into updated preferences text — standing facts only (name, stated
// preferences), never the episodic content retiring with the fold.
async function distillFoldIntoPreferences(
  foldSummaryText: string,
  priorPreferences: string,
  traceAnchor: TraceAnchor,
): Promise<string> {
  // Same loadPrompt-inside-span-callback and cast reasoning as
  // summarizeConversation's generateSummaryText above.
  async function generateDistilledText(span: Span): Promise<string> {
    const promptTemplate = await loadPrompt({
      projectId: process.env.BRAINTRUST_PROJECT_ID,
      slug: DISTILLER_PROMPT_SLUG,
      defaults: { model: MODEL },
    });
    const { messages } = promptTemplate.build({
      prior_preferences: priorPreferences || "(none)",
      fold_summary: foldSummaryText,
    });

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
    if (result.usage?.inputTokenDetails?.cacheReadTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_read.input_tokens",
        result.usage.inputTokenDetails.cacheReadTokens,
      );
    }
    if (result.usage?.inputTokenDetails?.cacheWriteTokens !== undefined) {
      span.setAttribute(
        "gen_ai.usage.cache_creation.input_tokens",
        result.usage.inputTokenDetails.cacheWriteTokens,
      );
    }

    return result.text;
  }

  // Same safety-to-span reasoning as summarizeConversation above.
  return withTurnSpan(
    traceAnchor,
    "gen_ai.chat",
    { "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL },
    generateDistilledText,
  );
}

// Enforces MAX_RECENT_FOLDS: re-reads fresh from Postgres (self-correcting
// regardless of whether this event's own fold insert landed), distilling
// the oldest excess row(s) one at a time — loops rather than assuming only
// one excess row, so it stays correct even after e.g. a backfill.
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

// The fold path — called from run-guest-turn.ts's "fold-memory-summary" step,
// after the guest already has their reply. A no-op when nothing new has
// dropped out of the trimmed window since the last fold.
export async function foldMemory(params: {
  conversationId: string;
  phone: string;
  traceAnchor: TraceAnchor;
}): Promise<void> {
  const { conversationId, phone, traceAnchor } = params;
  const { newlyDroppedRows } = await loadMemoryState(conversationId, phone);
  if (newlyDroppedRows.length === 0) return;

  // Always redacted — these rows are, by definition, old enough to be
  // dropped from active history and summarized, so the recent-window
  // exemption above doesn't apply. toModelMessage is text-only, so the
  // summariser never sees replayed tool JSON.
  const newlyDroppedMessages = newlyDroppedRows.map((row) => toModelMessage(row, true));
  const oldestDroppedId = newlyDroppedRows[0].id;
  const newWatermark = newlyDroppedRows[newlyDroppedRows.length - 1].id;

  // prior_summary is always "" here — this row reflects newlyDroppedMessages
  // standing alone, never blended with prior summary text, or it reproduces
  // the re-compression/fidelity-loss problem this table exists to avoid.
  // Caught locally (not left to reject the Promise.all below) since the
  // watermark must keep advancing regardless of this write's outcome.
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

  // Sequenced after, not concurrent with, the writes above — avoids racing
  // on guest_memory_folds' row count, and guarantees the watermark upsert
  // has already run before maintainFoldWindow might need the guest_memory
  // row. Own try/catch: a distillation failure must not affect the two
  // writes above, which already succeeded.
  try {
    await maintainFoldWindow(phone, traceAnchor);
  } catch (err) {
    console.error(`[memory] maintainFoldWindow failed for phone ${phone}:`, err);
  }
}
