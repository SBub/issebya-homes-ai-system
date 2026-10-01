/**
 * A scripted model for the agent harness demos. It never calls a network.
 * Given a fixture of rounds, each call answers with the next round: either
 * the tool calls the model "wants" or its final text. It records every
 * message list it was called with, so a test or a demo can show what the
 * model saw on each round.
 *
 * The message shapes follow the AI SDK's `ModelMessage` closely enough for
 * the docs to read the same, without importing the SDK.
 */

type TextPart = { type: "text"; text: string };

type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
};

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | Array<TextPart | ToolCallPart> }
  | { role: "tool"; content: ToolResultPart[] };

export type ToolCall = { toolCallId: string; toolName: string; input: Record<string, unknown> };

/** One scripted answer: the tool calls the model requests, or its final text. */
export type ScriptedRound =
  { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> } | { text: string };

type ModelResult = {
  text: string;
  toolCalls: ToolCall[];
  /** The assistant message the SDK would hand back for this call, to append to the conversation. */
  response: { messages: Message[] };
};

export type FakeModel = {
  generate(messages: Message[]): Promise<ModelResult>;
  /** Every message list this model was called with, one entry per call. */
  readonly calls: Message[][];
};

/**
 * Builds a model that answers with `rounds` in order. Once the fixture is
 * used up it returns an empty reply (no text, no tool calls), the same
 * shape a reasoning model produces when it spends its whole budget thinking.
 */
export function createFakeModel(rounds: ScriptedRound[]): FakeModel {
  const calls: Message[][] = [];
  let nextCallId = 1;

  return {
    calls,
    async generate(messages) {
      calls.push(messages);
      const round = rounds[calls.length - 1];

      if (round === undefined) {
        return { text: "", toolCalls: [], response: { messages: [] } };
      }
      if ("text" in round) {
        return {
          text: round.text,
          toolCalls: [],
          response: { messages: [{ role: "assistant", content: round.text }] },
        };
      }
      const toolCalls = round.toolCalls.map((call) => ({
        toolCallId: `call_${nextCallId++}`,
        toolName: call.toolName,
        input: call.input,
      }));
      return {
        text: "",
        toolCalls,
        response: {
          messages: [
            {
              role: "assistant",
              content: toolCalls.map((call) => ({ type: "tool-call" as const, ...call })),
            },
          ],
        },
      };
    },
  };
}
