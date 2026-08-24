import { describe, expect, it } from "vitest";
import { toolCallMatch } from "../../evals/evaluators";
import type { SingleTurnResult } from "../../evals/types";

// Covers the expectedAlternative acceptance path when expected.toolCall
// names a specific tool (not just the pre-existing null-toolCall case) —
// e.g. get_current_date is a legitimate first step toward resolving a
// relative date ("next available weekend") before run_code/check_availability
// becomes reachable.

function result(toolCalls: SingleTurnResult["toolCalls"]): SingleTurnResult {
  return { toolCalls, toolNames: toolCalls.map((c) => c.toolName), text: "" };
}

describe("toolCallMatch", () => {
  it("scores 1 when the actual call matches the named expected tool directly", () => {
    const score = toolCallMatch({
      output: result([{ toolName: "run_code", args: {} }]),
      expected: { toolCall: { name: "run_code" }, expectedAlternative: null },
    });
    expect(score.score).toBe(1);
  });

  it("scores 1 when the actual call matches expectedAlternative instead of the named expected tool", () => {
    const score = toolCallMatch({
      output: result([{ toolName: "get_current_date", args: {} }]),
      expected: { toolCall: { name: "run_code" }, expectedAlternative: "get_current_date" },
    });
    expect(score.score).toBe(1);
  });

  it("scores 0 when neither the named expected tool nor expectedAlternative was called", () => {
    const score = toolCallMatch({
      output: result([{ toolName: "answer_property_question", args: {} }]),
      expected: { toolCall: { name: "run_code" }, expectedAlternative: "get_current_date" },
    });
    expect(score.score).toBe(0);
  });

  it("scores 0 on a mismatched call when no expectedAlternative is set (unchanged prior behavior)", () => {
    const score = toolCallMatch({
      output: result([{ toolName: "get_current_date", args: {} }]),
      expected: { toolCall: { name: "run_code" }, expectedAlternative: null },
    });
    expect(score.score).toBe(0);
  });
});
