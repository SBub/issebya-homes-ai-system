/**
 * The correlation id travels inside the message, because the reply channel
 * has no session: a chat app delivers a button tap with the button's own
 * data, and a reply with the text of the message it replies to. Both are
 * composed here and parsed back here, so the two ends cannot drift apart.
 */

export type Button = { label: string; data: string };

export type Nudge = { text: string; buttons: Button[] };

/** `[ref:<id>]` at the very end of the text. The id is an opaque token, not assumed to be a UUID. */
const REF_PATTERN = /\[ref:([^\]\s]+)\]\s*$/;

export function tagWithRef(text: string, id: string): string {
  return `${text}\n\n[ref:${id}]`;
}

/** The id out of the text of the message that was replied to, or null when it carries none. */
export function parseRef(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = REF_PATTERN.exec(text);
  return match === null ? null : match[1];
}

export type ButtonAction = "approve" | "reject";

/** Button data is short (a chat app caps it at tens of bytes): the action and the id, nothing else. */
export function buttonData(action: ButtonAction, id: string): string {
  return `${action}:${id}`;
}

export function parseButtonData(
  data: string | null | undefined,
): { action: ButtonAction; id: string } | null {
  if (!data) return null;
  const separator = data.indexOf(":");
  if (separator === -1) return null;
  const action = data.slice(0, separator);
  const id = data.slice(separator + 1);
  if ((action !== "approve" && action !== "reject") || id === "") return null;
  return { action, id };
}

/** A question the approver answers in free text: the id rides in a tag at the end. */
export function composeQuestion(id: string, question: string): Nudge {
  return {
    text: tagWithRef(
      `Question from the conversation: "${question}"\nReply to this message with the answer.`,
      id,
    ),
    buttons: [],
  };
}

/** A yes or no the approver gives with one tap: the id rides in each button's data. */
export function composeDecision(id: string, reason: string): Nudge {
  return {
    text: `${reason}\nApprove?`,
    buttons: [
      { label: "Approve", data: buttonData("approve", id) },
      { label: "Reject", data: buttonData("reject", id) },
    ],
  };
}
