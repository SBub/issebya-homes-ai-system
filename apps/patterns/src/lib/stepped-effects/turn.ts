import { createFakeModel, type Message, type ScriptedRound } from "@/lib/harness/fake-model";
import type { DurableFunction } from "@/lib/harness/step-runner";

/**
 * The turn behind the `step-memoized-side-effects` demo, on the harness
 * step runner. Four kinds of side effect, each in its own step: the prompt
 * fetch (hoisted out of the loop), every model call, every tool round, and
 * the send. A replay answers each from the memo and none of them happens
 * twice.
 *
 * The wrong variants exist so the demo can show the failure:
 * - `"send-unstepped"`: the send is plain function code, so a replay sends again.
 * - `"prompt-in-loop"`: the prompt is fetched by plain code at the top of
 *   every round, so a replay fetches it once more per finished round.
 * - `"nested"`: the send is called from inside the last model step's
 *   callback, which the runner refuses.
 */

export type TurnMode = "stepped" | "send-unstepped" | "prompt-in-loop" | "nested";

export type TurnOptions = {
  /** Receives one line per side effect, as it happens. */
  record: (effect: string) => void;
  mode?: TurnMode;
};

export type TurnResult = { text: string; rounds: number };

const MAX_ROUNDS = 4;
const PROMPT = "You are a short, polite assistant.";

const SCRIPT: ScriptedRound[] = [
  { toolCalls: [{ toolName: "check_dates", input: { from: "2026-10-06", to: "2026-10-08" } }] },
  { text: "The 6th to the 8th is free." },
];

export function createTurnFunction(options: TurnOptions): DurableFunction<TurnResult> {
  const { record, mode = "stepped" } = options;

  return async ({ event, step }) => {
    const text = String(event.data.text);
    const model = createFakeModel(SCRIPT);

    const fetchPrompt = () => {
      record("fetch prompt");
      return PROMPT;
    };
    const send = (reply: string) => {
      record(`send reply "${reply}"`);
      return true;
    };

    // Hoisted: once per turn, in its own step, never once per round.
    let prompt = mode === "prompt-in-loop" ? "" : await step.run("load-prompt", fetchPrompt);
    let messages: Message[] = [{ role: "user", content: text }];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (mode === "prompt-in-loop") prompt = fetchPrompt();

      const reply = await step.run(`model-${round}`, async () => {
        record(`call model, round ${round} (${prompt.length} chars of prompt)`);
        const result = await model.generate(messages);
        if (mode === "nested" && result.toolCalls.length === 0) {
          // A step inside a step: the runner refuses this.
          await step.run("send-reply", () => send(result.text));
        }
        return { text: result.text, toolCalls: result.toolCalls, response: result.response };
      });

      if (reply.toolCalls.length === 0) {
        if (mode === "send-unstepped") send(reply.text);
        else await step.run("send-reply", () => send(reply.text));
        return { text: reply.text, rounds: round };
      }

      const outputs = await step.run(`tools-${round}`, () =>
        reply.toolCalls.map((call) => {
          record(`run tool ${call.toolName}`);
          return { free: true, ...call.input };
        }),
      );
      messages = [
        ...messages,
        ...reply.response.messages,
        {
          role: "tool",
          content: reply.toolCalls.map((call, index) => ({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: outputs[index],
          })),
        },
      ];
    }

    const fallback = "Sorry, I could not process that.";
    await step.run("send-reply", () => send(fallback));
    return { text: fallback, rounds: MAX_ROUNDS };
  };
}
