import type { Message } from "@/lib/harness/fake-model";

/**
 * Turn replay history behind the `turn-replay-history` demo. A conversation
 * is stored as rows: a user row per incoming message and an assistant row
 * per reply, the assistant row carrying the turn's own messages (tool calls,
 * tool results, the reply). History is rebuilt from rows on every turn:
 * grouped by turn, the last few turns replayed verbatim, older turns as
 * text, then trimmed by whole turns to a token budget.
 */

export type MessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** The turn's own messages, on the assistant row only. Null replays as text. */
  turnMessages: Message[] | null;
};

/**
 * Makes a turn's messages safe to replay next to other rows: only assistant
 * text and tool-call parts and tool messages are kept, and the array always
 * ends in assistant text so no tool call is left without its result.
 */
export function finalizeTurn(tail: Message[], replyText: string): Message[] {
  const messages = tail.flatMap((message): Message[] => {
    if (message.role === "tool") return [message];
    if (message.role !== "assistant") return [];
    if (typeof message.content === "string") return [message];
    const content = message.content.filter(
      (part) => part.type === "text" || part.type === "tool-call",
    );
    return content.length > 0 ? [{ ...message, content }] : [];
  });
  const last = messages.at(-1);
  if (!(last?.role === "assistant" && typeof last.content === "string")) {
    messages.push({ role: "assistant", content: replyText });
  }
  return messages;
}

/** A user row starts a group; the assistant rows after it join it. */
export function groupByTurn(rows: MessageRow[]): MessageRow[][] {
  const groups: MessageRow[][] = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (row.role === "user" || current === undefined) groups.push([row]);
    else current.push(row);
  }
  return groups;
}

function asText(row: MessageRow): Message {
  return row.role === "user"
    ? { role: "user", content: row.content }
    : { role: "assistant", content: row.content };
}

/**
 * One message list per turn group, oldest first. The last `verbatimTurns`
 * groups replay the stored turn messages word for word; every older group,
 * and every row without stored messages, replays as text.
 */
export function buildHistory(rows: MessageRow[], options: { verbatimTurns: number }): Message[][] {
  const groups = groupByTurn(rows);
  return groups.map((group, index) => {
    const verbatim = groups.length - index <= options.verbatimTurns;
    return group.flatMap((row) => {
      const stored = verbatim && row.role === "assistant" ? row.turnMessages : null;
      return stored === null ? [asText(row)] : stored;
    });
  });
}

/** A stand-in for a tokenizer: about four characters per token. */
export function estimateTokens(messages: Message[]): number {
  return messages.reduce((total, message) => {
    const text =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return total + Math.ceil(text.length / 4);
  }, 0);
}

/**
 * Over `max` tokens, drops whole groups from the oldest until the rest fits
 * in `keep`. Never splits a group, which would leave a tool call without
 * its result, and never drops the last group, the turn being answered.
 */
export function trimToBudget(
  groups: Message[][],
  budget: { max: number; keep: number },
): { kept: Message[][]; dropped: number } {
  if (estimateTokens(groups.flat()) <= budget.max) return { kept: groups, dropped: 0 };
  const kept = [...groups];
  while (kept.length > 1 && estimateTokens(kept.flat()) > budget.keep) kept.shift();
  return { kept, dropped: groups.length - kept.length };
}
