import type { DurableFunction, DurableRun, StepEvent } from "@/lib/harness/step-runner";
import {
  type Button,
  composeDecision,
  composeQuestion,
  parseButtonData,
  parseRef,
} from "./correlation";

/**
 * The request behind the `in-band-correlation` demo: a durable function
 * that asks the approver a question (free text, `[ref:<id>]` tag), waits,
 * then asks for a decision (buttons with the id in their data), waits
 * again. The chat is a transcript the demo renders; the relay is what the
 * chat's webhook does with an update: parse the id out of the message and
 * send the event as it came. It never looks anything up.
 */

export const ANSWER_EVENT = "request.answered";
export const DECISION_EVENT = "request.decided";

export type ChatMessage = {
  id: number;
  from: "agent" | "approver";
  text: string;
  buttons: Button[];
  /** For an approver message: the agent message it replies to. */
  replyTo: number | null;
};

export type Chat = {
  post(message: Omit<ChatMessage, "id">): ChatMessage;
  find(id: number): ChatMessage | null;
  getSnapshot(): ChatMessage[];
  subscribe(listener: () => void): () => void;
  clear(): void;
};

export function createChat(): Chat {
  const listeners = new Set<() => void>();
  let messages: ChatMessage[] = [];
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    post(message) {
      const posted = { ...message, id: messages.length + 1 };
      messages = [...messages, posted];
      emit();
      return posted;
    },
    find: (id) => messages.find((message) => message.id === id) ?? null,
    getSnapshot: () => messages,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      messages = [];
      emit();
    },
  };
}

export type RequestResult = { answer: string | null; approved: boolean };

export function createRequestFunction(deps: {
  chat: Chat;
  timeout: number;
}): DurableFunction<RequestResult> {
  const { chat, timeout } = deps;
  return async ({ event, step }) => {
    const id = String(event.data.id);
    const question = String(event.data.question);

    // The nudge carries the id in its text; the reply will carry that text back.
    await step.run("send-question", () => {
      chat.post({ from: "agent", replyTo: null, ...composeQuestion(id, question) });
      return true;
    });
    const answered = await step.waitForEvent("wait-for-answer", {
      event: ANSWER_EVENT,
      match: "data.id",
      timeout,
    });
    if (answered === null) return { answer: null, approved: false };
    const answer = String(answered.data.answer);

    // The second nudge carries the id in each button's data.
    await step.run("send-decision", () => {
      chat.post({
        from: "agent",
        replyTo: null,
        ...composeDecision(id, `The answer is "${answer}". Send it to the conversation?`),
      });
      return true;
    });
    const decided = await step.waitForEvent("wait-for-decision", {
      event: DECISION_EVENT,
      match: "data.id",
      timeout,
    });
    return { answer, approved: decided !== null && decided.data.approved === true };
  };
}

export type ChatUpdate =
  { kind: "tap"; data: string } | { kind: "reply"; replyTo: number; text: string };

export type RelayOutcome = {
  id: string | null;
  event: StepEvent | null;
  resumed: boolean;
  note: string;
};

export type RelayOptions = {
  chat: Chat;
  runs: DurableRun<RequestResult>[];
  /**
   * `"message"` is the pattern: the id comes out of the message replied to.
   * `"latest"` is the wrong variant: the most recent question is assumed to be the one answered.
   */
  lookup?: "message" | "latest";
};

function latestQuestionId(chat: Chat): string | null {
  const questions = chat.getSnapshot().filter((message) => parseRef(message.text) !== null);
  const latest = questions.at(-1);
  return latest === undefined ? null : parseRef(latest.text);
}

/** The chat webhook: one update in, at most one event out, delivered to whichever run is waiting on that id. */
export async function relayUpdate(
  update: ChatUpdate,
  options: RelayOptions,
): Promise<RelayOutcome> {
  const { chat, runs, lookup = "message" } = options;

  let id: string | null;
  let event: StepEvent | null = null;
  if (update.kind === "tap") {
    const parsed = parseButtonData(update.data);
    id = parsed?.id ?? null;
    if (parsed !== null) {
      event = {
        name: DECISION_EVENT,
        data: { id: parsed.id, approved: parsed.action === "approve" },
      };
    }
  } else {
    chat.post({ from: "approver", text: update.text, buttons: [], replyTo: update.replyTo });
    // The chat app echoes the replied-to message's text with the reply: the tag is right there.
    id = lookup === "latest" ? latestQuestionId(chat) : parseRef(chat.find(update.replyTo)?.text);
    if (id !== null) event = { name: ANSWER_EVENT, data: { id, answer: update.text } };
  }

  if (id === null || event === null) {
    return { id: null, event: null, resumed: false, note: "no id in the update: ignored" };
  }

  let resumed = false;
  for (const run of runs) {
    if (await run.send(event)) resumed = true;
  }
  return {
    id,
    event,
    resumed,
    note: resumed ? `resumed the run waiting on ${id}` : `no run is waiting on ${id}: ignored`,
  };
}
