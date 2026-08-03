import type { ModelMessage } from "ai";
import { loadGuestInfo, loadRecentMessages } from "@/lib/db";

// Loads recent conversation history and past-stay guest facts fresh from
// Postgres. Returns only the *prior* history, oldest first — the caller
// (run-turn.ts) appends the turn's new incoming message itself.
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
