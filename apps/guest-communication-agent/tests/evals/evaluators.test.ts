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

  // check_availability is args-scored: the 2026-09-21 production incident
  // resolved "October 11-13" to 2025, check_availability reported the past
  // as available, and a 2025 booking link went out. Name-only matching
  // scored that turn 1.
  describe("check_availability args", () => {
    const expected = {
      toolCall: {
        name: "check_availability",
        args: { room: "room1", checkIn: "2026-10-11", checkOut: "2026-10-13" },
      },
      expectedAlternative: null,
    };

    it("scores 0 when check_availability is called with the wrong year", () => {
      const score = toolCallMatch({
        output: result([
          {
            toolName: "check_availability",
            args: { room: "room1", checkIn: "2025-10-11", checkOut: "2025-10-13" },
          },
        ]),
        expected,
      });
      expect(score.score).toBe(0);
    });

    it("scores 1 when check_availability args match, regardless of key order", () => {
      const score = toolCallMatch({
        output: result([
          {
            toolName: "check_availability",
            args: { checkOut: "2026-10-13", checkIn: "2026-10-11", room: "room1" },
          },
        ]),
        expected,
      });
      expect(score.score).toBe(1);
    });

    it("still scores tools outside the allowlist on name alone even when the row carries args", () => {
      const score = toolCallMatch({
        output: result([{ toolName: "get_pricing", args: { room: "room2" } }]),
        expected: {
          toolCall: { name: "get_pricing", args: { room: "room1" } },
          expectedAlternative: null,
        },
      });
      expect(score.score).toBe(1);
    });
  });
});
