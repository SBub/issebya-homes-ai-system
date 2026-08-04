import type { ModelMessage } from "ai";
import { trimToTokenBudget } from "@/agent/context";
import { loadGuestInfo, loadRecentMessages } from "@/lib/db";

// Loads recent conversation history and past-stay guest facts fresh from
// Postgres. Returns only the *prior* history, oldest first — the caller
// (run-turn.ts) appends the turn's new incoming message itself.
//
// History sizing is now token-budget-driven (see ./context.ts), not a row
// count: loadRecentMessages applies only a generous safety-ceiling row
// limit at the DB level, and trimToTokenBudget below does the real work of
// bounding how much of that fetched set actually gets used.
export interface LoadedContext {
  historyMessages: ModelMessage[];
  guestContext: string | null;
}

export async function loadContext(params: {
  conversationId: string;
  phone: string;
}): Promise<LoadedContext> {
  const { conversationId, phone } = params;

  const [history, guestInfo] = await Promise.all([
    loadRecentMessages(conversationId),
    loadGuestInfo(phone),
  ]);

  const rawHistoryMessages: ModelMessage[] = history.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: m.content },
  );

  // Token-budget trim: if the fetched set is over MAX_CONTEXT_TOKENS, drop
  // the oldest messages until back under KEEP_CONTEXT_TOKENS (see
  // ./context.ts for both constants and the trim shape, ported from
  // harness-engineering/harness/memory.ts).
  const historyMessages = trimToTokenBudget(rawHistoryMessages);

  // TODO(agent-memory): once a persisted rolling summary exists (the
  // dormant guest_memory table — phone_number PK, summary text, updated_at
  // — is unpopulated today; no summarizer exists yet), inject it here as a
  // system/context message ahead of `historyMessages`, e.g.:
  //   const summary = await loadGuestMemory(phone); // not built yet
  //   if (summary) {
  //     return {
  //       historyMessages: [
  //         { role: "system", content: `Summary of earlier conversation:\n${summary}` },
  //         ...historyMessages,
  //       ],
  //       guestContext: guestInfo,
  //     };
  //   }
  // Deliberately left inert in this step — persistent agent memory (step 2)
  // is scoped separately. See TASK_FOR_TOMORROW.md.

  return { historyMessages, guestContext: guestInfo };
}
