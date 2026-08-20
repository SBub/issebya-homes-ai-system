import { describe, expect, it } from "vitest";
import { runWantsHuman } from "@/agent/tools/wants-human";

// wants-human.ts is now pure (no step/span/Inngest of any kind — see
// run-turn.ts's "tool files stay pure" rule). The real owner-nudge send
// (stepped/spanned for replay-safety) moved into run-turn.ts's private
// dispatchWantsHuman — see run-turn.test.ts's "wants_human" coverage for
// that behavior now. All that's left here is the tool's own result shape,
// branched on the already-known `nudged` outcome dispatchWantsHuman passes in.
describe("runWantsHuman", () => {
  it("returns the notified message when the nudge succeeded", () => {
    expect(runWantsHuman(true)).toEqual({
      escalated: true,
      message: "The owner has been notified and will be in touch shortly.",
    });
  });

  it("returns the honest fallback message when the nudge failed", () => {
    expect(runWantsHuman(false)).toEqual({
      escalated: true,
      message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
    });
  });
});
