import type { FakeModel, Message, ToolCall } from "@/lib/harness/fake-model";

/**
 * The manual tool loop behind the `manual-tool-loop` demo: call the model,
 * dispatch the tool calls it asks for, append one batched tool message, and
 * call again, until the model answers with text or the round cap fires.
 * The tools are schema-only (a name and a description for the model, no
 * `execute`), so nothing runs before this loop decides to run it.
 */

export const FALLBACK_TEXT = "Sorry, I could not process that. Please try again shortly.";

export type ToolRunner = (name: string, input: Record<string, unknown>) => Promise<unknown>;

/** The schema half of a tool: what the model sees. The run half is `runTool` below. */
export const tools = {
  check_dates: { description: "Whether a date range is free" },
  lookup_rate: { description: "The nightly rate for a date range" },
} as const;

/** The dispatch half. An unknown name is an error object, not a throw: the model reads it and corrects itself. */
export const runTool: ToolRunner = async (name, input) => {
  switch (name) {
    case "check_dates":
      return { free: true, from: input.from, to: input.to };
    case "lookup_rate":
      return { nightly: 120, currency: "EUR" };
    default:
      return { error: `Unknown tool "${name}". Valid tools: ${Object.keys(tools).join(", ")}.` };
  }
};

/** One `tool` message per round: one result part per call, in call order. */
export function toolResultMessage(calls: ToolCall[], outputs: unknown[]): Message {
  return {
    role: "tool",
    content: calls.map((call, index) => ({
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: outputs[index],
    })),
  };
}

type TurnEnd = "text" | "empty-reply" | "round-cap";

export type TurnResult = {
  /** The whole conversation after this turn. */
  messages: Message[];
  /** This turn's own messages: everything after the history that was passed in. */
  turnMessages: Message[];
  rounds: number;
  reply: string;
  ended: TurnEnd;
};

export type TurnOptions = {
  maxRounds: number;
  runTool?: ToolRunner;
  /** Called after each round, so a demo can render rounds as they happen. */
  onRound?: (messages: Message[]) => void | Promise<void>;
};

export async function runTurn(
  model: Pick<FakeModel, "generate">,
  history: Message[],
  options: TurnOptions,
): Promise<TurnResult> {
  const dispatch = options.runTool ?? runTool;
  let messages = history;
  let rounds = 0;

  while (rounds < options.maxRounds) {
    rounds += 1;
    const result = await model.generate(messages);

    if (result.toolCalls.length === 0) {
      const empty = result.text.trim() === "";
      const reply = empty ? FALLBACK_TEXT : result.text;
      messages = [...messages, { role: "assistant", content: reply }];
      await options.onRound?.(messages);
      return {
        messages,
        turnMessages: messages.slice(history.length),
        rounds,
        reply,
        ended: empty ? "empty-reply" : "text",
      };
    }

    const outputs = await Promise.all(
      result.toolCalls.map((call) => dispatch(call.toolName, call.input)),
    );
    messages = [
      ...messages,
      ...result.response.messages,
      toolResultMessage(result.toolCalls, outputs),
    ];
    await options.onRound?.(messages);
  }

  // The cap fired on a tool message. The fallback is the reply; the stored
  // turn gets it appended so the array ends in assistant text.
  return {
    messages,
    turnMessages: messages.slice(history.length),
    rounds,
    reply: FALLBACK_TEXT,
    ended: "round-cap",
  };
}
