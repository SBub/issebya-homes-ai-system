import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { GraphStateType } from "@/graph/state";
import { loadGuestInfo, loadRecentMessages } from "@/lib/db";

// Ported verbatim from issebya-homes-website's
// apps/guest-communication-agent/src/graph/nodes/load-context.ts — no
// import path changes needed, @/lib/db resolves the same way here.
//
// Loads everything the agent node needs before it can reason about this
// turn: recent conversation history and past-stay facts about the guest.
// Both are read fresh from Postgres on every invocation — the graph is
// stateless per-turn, so nothing about the guest or the conversation is
// assumed to already be sitting in `state` when this node runs (only
// conversationId/phone/incomingMessage are caller-supplied inputs).
//
// Message ordering: state.messages starts empty (the caller leaves it
// empty and passes the new guest message via state.incomingMessage
// instead — see state.ts for why). MessagesAnnotation's reducer
// (add_messages) only ever *appends* whatever a node returns onto whatever
// is already in state.messages, so the only way to land the turn's
// messages in correct chronological order (older history, then the new
// message last) is to return them as a single already-ordered array from
// one node. That's what happens here: fetch the last
// RECENT_MESSAGE_LIMIT history rows (oldest first), convert each to a
// HumanMessage/AIMessage, and append one final HumanMessage built from
// state.incomingMessage — then return the whole ordered array in one
// `messages` update. Do NOT split this into "load_context appends history,
// something else appends the new message" — with an append-only reducer,
// whichever piece runs/returns second would still just be appended after
// the first, so the only way two separate updates land in a chosen order is
// if they happen in two separate reducer applications in that exact
// sequence — fragile and easy to break by reordering nodes later. Keeping
// both concerns (history + new message) in this one return statement makes
// the ordering an invariant of this function, not of the graph's wiring.
export async function loadContext(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { conversationId, phone, incomingMessage } = state;

  const [history, guestInfo] = await Promise.all([
    loadRecentMessages(conversationId),
    loadGuestInfo(phone),
  ]);

  const historyMessages = history.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
  const newMessage = new HumanMessage(incomingMessage);

  return {
    messages: [...historyMessages, newMessage],
    guestContext: guestInfo,
  };
}
