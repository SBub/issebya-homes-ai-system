import type { ModelMessage } from "ai";
import { loadGuestInfo, loadRecentMessages } from "@/lib/db";

// Loads everything runAgentTurn needs before it can reason about a turn:
// recent conversation history and past-stay facts about the guest. Both are
// read fresh from Postgres on every invocation — nothing about the guest or
// the conversation is carried over in memory between turns, only
// conversationId/phone/incomingMessage are caller-supplied inputs.
//
// This only returns the *prior* history, oldest first — it deliberately does
// NOT append the turn's new incoming message. That used to matter a lot: the
// old LangGraph port had to route the new message through a side-channel
// field and let a single node return history+newMessage as one already-
// ordered array, purely to dodge MessagesAnnotation's append-only reducer
// (see git history/state.ts for that gory detail). A plain function has no
// such reducer to dodge — the caller (run-turn.ts) just does
// `[...historyMessages, { role: "user", content: incomingMessage }]`
// directly, so this function's only job is fetching and ordering the
// history.
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

  const historyMessages: ModelMessage[] = history.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: m.content },
  );

  return { historyMessages, guestContext: guestInfo };
}
