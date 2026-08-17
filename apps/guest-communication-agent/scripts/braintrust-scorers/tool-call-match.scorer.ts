/**
 * Registers "Tool Call Match" as a real Braintrust Scorer Function, so it's
 * selectable in the UI (Playground / manually-created experiments) against
 * any dataset with an `expected.toolCall`/`expected.expectedAlternative`
 * shape — currently "Send Booking Link — Golden Dataset" (project
 * "issebya-homes-ai-system", id 84950d66-e509-45cc-a50f-7dcb6352a15a).
 *
 * Ports evals/evaluators.ts's toolCallMatch logic unchanged (same deepEqual,
 * same scoring rules) but widens `output` handling: evals/evaluators.ts only
 * ever sees evals/executors.ts's own SingleTurnResult shape
 * ({toolCalls: [{toolName, args}]}), because that's the only task that ever
 * calls it there. A manually-created experiment running a Prompt directly
 * through Braintrust's Playground never calls that task — it produces
 * Braintrust's own standard OpenAI-shaped assistant output instead
 * (tool_calls: [{function: {name, arguments: <JSON string>}}], confirmed in
 * node_modules/braintrust/dist/index.d.ts's chat-message schemas). This
 * handler normalizes either shape into a common {toolName, args}[] before
 * scoring, so it works from both places. If a third, still-different output
 * shape shows up in practice, this handler's `extractToolCalls` is the one
 * place to widen.
 *
 * Push with: yarn bt functions push --env-file=.env scripts/braintrust-scorers
 */
import { projects } from "braintrust";

const project = projects.create({ name: "issebya-homes-ai-system" });

interface NormalizedToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

interface ExpectedShape {
  toolCall: { name: string; args?: Record<string, unknown> } | null;
  expectedAlternative: string | null;
}

// Our own executors.ts's SingleTurnResult shape.
interface OwnEvalOutput {
  toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>;
}

// Braintrust/OpenAI-standard assistant-message shape a Playground-run Prompt
// produces (node_modules/braintrust/dist/index.d.ts's chat message schemas,
// e.g. around its `tool_calls: { function: { name, arguments } }[]` field).
interface StandardChatOutput {
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
}

function extractToolCalls(output: unknown): NormalizedToolCall[] {
  if (!output || typeof output !== "object") return [];

  const own = output as OwnEvalOutput;
  if (Array.isArray(own.toolCalls)) {
    return own.toolCalls.map((c) => ({ toolName: c.toolName, args: c.args ?? {} }));
  }

  const standard = output as StandardChatOutput;
  if (Array.isArray(standard.tool_calls)) {
    return standard.tool_calls
      .filter((c) => c.function?.name)
      .map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          args = {};
        }
        return { toolName: c.function!.name as string, args };
      });
  }

  return [];
}

// Same key-order-insensitive structural compare as evals/evaluators.ts's
// deepEqual — see that file's own comment for why a naive JSON.stringify
// compare produced a real false negative.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

project.scorers.create({
  name: "Tool Call Match",
  slug: "gca-tool-call-match",
  description:
    "Offline-eval scorer: does this row's actual tool call match expected.toolCall (exact name match; deep-equal args when expected.toolCall.name is send_booking_link)? expected.toolCall: null means a text-only reply was expected, UNLESS expected.expectedAlternative names a specific tool, in which case a call to that tool scores 1. Requires a dataset row with an expected.toolCall/expected.expectedAlternative shape — not meaningful against arbitrary production logs.",
  ifExists: "replace",
  handler: async ({ output, expected }) => {
    const expectedShape = expected as ExpectedShape | undefined;
    const expectedCall = expectedShape?.toolCall ?? null;
    const calls = extractToolCalls(output);

    if (expectedCall === null) {
      const expectedAlternative = expectedShape?.expectedAlternative ?? null;

      // A row can set toolCall: null while naming a specific OTHER tool in
      // expectedAlternative — that means "should call THAT tool, not this
      // one," not "should call nothing." null/"text-only" (or anything else
      // that isn't a real tool name some row uses) keeps the original
      // zero-tool-calls check.
      if (expectedAlternative !== null && expectedAlternative !== "text-only") {
        const altMatch = calls.some((call) => call.toolName === expectedAlternative);
        return {
          name: "Tool Call Match",
          score: altMatch ? 1 : 0,
          metadata: {
            rationale: altMatch
              ? `Expected alternative tool "${expectedAlternative}" was called.`
              : `Expected alternative tool "${expectedAlternative}" but got: ${
                  calls.length > 0
                    ? calls.map((c) => c.toolName).join(", ")
                    : "no tool call (text-only reply)"
                }.`,
            expected: expectedCall,
            expectedAlternative,
            actual: calls,
          },
        };
      }

      const matched = calls.length === 0;
      return {
        name: "Tool Call Match",
        score: matched ? 1 : 0,
        metadata: {
          rationale: matched
            ? "Expected no tool call (text-only reply) and none was made."
            : `Expected no tool call but got: ${calls.map((c) => c.toolName).join(", ")}.`,
          expected: expectedCall,
          actual: calls,
        },
      };
    }

    const match = calls.find((call) => call.toolName === expectedCall.name);
    if (!match) {
      return {
        name: "Tool Call Match",
        score: 0,
        metadata: {
          rationale: `Expected tool "${expectedCall.name}" but got: ${
            calls.length > 0
              ? calls.map((c) => c.toolName).join(", ")
              : "no tool call (text-only reply)"
          }.`,
          expected: expectedCall,
          actual: calls,
        },
      };
    }

    if (expectedCall.name === "send_booking_link") {
      const argsMatch = deepEqual(match.args, expectedCall.args ?? {});
      return {
        name: "Tool Call Match",
        score: argsMatch ? 1 : 0,
        metadata: {
          rationale: argsMatch
            ? "send_booking_link called with matching args."
            : "send_booking_link tool name matched but args differ from expected.",
          expected: expectedCall,
          actual: match,
        },
      };
    }

    return {
      name: "Tool Call Match",
      score: 1,
      metadata: {
        rationale: `Tool name "${expectedCall.name}" matched.`,
        expected: expectedCall,
        actual: match,
      },
    };
  },
});
