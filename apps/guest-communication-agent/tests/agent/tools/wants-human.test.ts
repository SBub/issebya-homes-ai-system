import { describe, expect, it } from "vitest";
import { runWantsHuman } from "@/agent/tools/wants-human";

// wants-human.ts is now pure (no step/span/Inngest of any kind — see
// run-turn.ts's "tool files stay pure" rule). The real owner-nudge send
// (stepped/spanned for replay-safety) moved into run-turn.ts's private
// dispatchWantsHuman — see run-turn.test.ts's "wants_human" coverage for
// that behavior now. All that's left here is the tool's own constant result
// shape.
describe("runWantsHuman", () => {
  it("returns the fixed escalated result, independent of any input", () => {
    expect(runWantsHuman()).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
  });
});
