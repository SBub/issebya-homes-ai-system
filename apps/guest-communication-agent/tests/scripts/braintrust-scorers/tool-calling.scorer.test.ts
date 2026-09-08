import { describe, expect, it } from "vitest";
import {
  type BraintrustSpanEvent,
  formatToolsCalled,
  gatherToolsCalled,
  parseClassifierResponse,
  TAG_ONLY_TOOLS,
  type ToolCallInfo,
} from "../../../scripts/braintrust-scorers/tool-calling.scorer";

// Hand-crafted fixtures matching the real span shapes this app emits (see
// src/agent/tool-execution.ts's dispatchToolExecution for the plain-tool
// gen_ai.tool.* shape, src/agent/tools/wants-human.ts for wants_human's, and
// src/agent/tools/missing-info.ts's/booking.ts's request<ToolName>Approval
// for the hitl.* gate/nudge/decision spans) — same fidelity
// hitl-compliance.scorer.test.ts's fixtures already have. gatherToolsCalled
// and formatToolsCalled are pure/deterministic (no network, no LLM), so
// these fixtures are the real proof of correctness.

const ROOT = "root-span-1";

function guestTurn(overrides: Partial<BraintrustSpanEvent> = {}): BraintrustSpanEvent {
  return {
    span_id: "guest-turn-span",
    root_span_id: ROOT,
    span_attributes: { name: "braintrust.guest_turn.result" },
    input: "Can you send me the booking link for room 1?",
    output: "I've asked the owner to approve — I'll send the link once they do.",
    tags: null,
    ...overrides,
  };
}

function toolSpan(name: string, input: string, output: string): BraintrustSpanEvent {
  return {
    span_id: `${name}-execution-span`,
    root_span_id: ROOT,
    span_attributes: { name: `gen_ai.tool.${name}` },
    input,
    output,
    metadata: { "gen_ai.tool.name": name },
  };
}

// hitl.<tool>.nudge — real shape from missing-info.ts's/booking.ts's
// request<ToolName>Approval — never a gen_ai.tool.* span, so
// gatherToolsCalled must ignore it (it only filters on that prefix).
function hitlNudgeSpan(tool: string): BraintrustSpanEvent {
  return {
    span_id: `hitl-${tool}-nudge-span`,
    root_span_id: ROOT,
    span_attributes: { name: `hitl.${tool}.nudge` },
    input: null,
    output: null,
    tags: [tool],
  };
}

function hitlNoReplySpan(tool: string): BraintrustSpanEvent {
  return {
    span_id: `hitl-${tool}-no-reply-span`,
    root_span_id: ROOT,
    span_attributes: { name: `hitl.${tool}.no_reply` },
    input: null,
    output: null,
    metadata: { "gca.timeout": "24h" },
  };
}

describe("gatherToolsCalled", () => {
  it("surfaces a tag-only missing_info entry with no gen_ai.tool.missing_info span — the exact regression this test guards", () => {
    // Before fixing TAG_ONLY_TOOLS (only listed send_booking_link), a
    // rejected/timed-out/nudge-failed missing_info call — real span shape
    // post-HITL-redesign: a hitl.missing_info gate span plus its
    // nudge/no_reply children, but NO gen_ai.tool.missing_info execution
    // span, since that's now only created once an answer arrives — was
    // silently dropped from the tools-called list the judge sees.
    const turn = guestTurn({ tags: ["missing_info"] });
    const gateSpan: BraintrustSpanEvent = {
      span_id: "hitl-missing-info-gate-span",
      root_span_id: ROOT,
      span_attributes: { name: "hitl.missing_info" },
      input: '{"reason":"Guest asked about parking"}',
      output: {
        escalated: true,
        message: "I wasn't able to reach the owner about this. Please try asking again in a bit.",
      },
    };
    const events = [turn, gateSpan, hitlNudgeSpan("missing_info"), hitlNoReplySpan("missing_info")];

    const result = gatherToolsCalled(turn, events);

    expect(result).toEqual<ToolCallInfo[]>([{ name: "missing_info" }]);
    expect(result[0].input).toBeUndefined();
    expect(result[0].output).toBeUndefined();
  });

  it("surfaces a tag-only send_booking_link entry with no gen_ai.tool.send_booking_link span", () => {
    const turn = guestTurn({ tags: ["send_booking_link"] });
    const events = [turn, hitlNudgeSpan("send_booking_link")];

    const result = gatherToolsCalled(turn, events);

    expect(result).toEqual<ToolCallInfo[]>([{ name: "send_booking_link" }]);
  });

  it("prefers the span-derived entry over the tag when both exist for missing_info (approved/answered path)", () => {
    const turn = guestTurn({ tags: ["missing_info"] });
    const events = [
      turn,
      toolSpan(
        "missing_info",
        '{"reason":"Guest asked about parking"}',
        '{"escalated":true,"answer":"yes, there is parking"}',
      ),
    ];

    const result = gatherToolsCalled(turn, events);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "missing_info",
      input: '{"reason":"Guest asked about parking"}',
      output: '{"escalated":true,"answer":"yes, there is parking"}',
    });
  });

  it("prefers the span-derived entry over the tag when both exist for send_booking_link (approved path)", () => {
    const turn = guestTurn({ tags: ["send_booking_link"] });
    const events = [
      turn,
      toolSpan("send_booking_link", '{"room":"room1"}', '{"url":"https://example.com/book"}'),
    ];

    const result = gatherToolsCalled(turn, events);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("send_booking_link");
    expect(result[0].input).toBe('{"room":"room1"}');
  });

  it("surfaces a plain non-gated tool via its span, with no tag involved", () => {
    const turn = guestTurn();
    const events = [turn, toolSpan("get_pricing", "{}", '{"price":100}')];

    const result = gatherToolsCalled(turn, events);

    expect(result).toEqual<ToolCallInfo[]>([
      { name: "get_pricing", input: "{}", output: '{"price":100}' },
    ]);
  });

  it("surfaces wants_human via its span even with no tag present (never tag-only)", () => {
    expect(TAG_ONLY_TOOLS.has("wants_human")).toBe(false);
    const turn = guestTurn({ tags: null });
    const events = [
      turn,
      toolSpan(
        "wants_human",
        '{"reason":"guest wants a human"}',
        '{"escalated":true,"message":"The owner has been notified and will be in touch shortly."}',
      ),
    ];

    const result = gatherToolsCalled(turn, events);

    expect(result).toEqual<ToolCallInfo[]>([
      {
        name: "wants_human",
        input: '{"reason":"guest wants a human"}',
        output:
          '{"escalated":true,"message":"The owner has been notified and will be in touch shortly."}',
      },
    ]);
  });

  it("returns an empty list when the turn has zero tool involvement", () => {
    const turn = guestTurn();
    const events = [turn];

    expect(gatherToolsCalled(turn, events)).toEqual([]);
  });

  it("ignores a tag that isn't in TAG_ONLY_TOOLS", () => {
    const turn = guestTurn({ tags: ["some_other_tag"] });
    const events = [turn];

    expect(gatherToolsCalled(turn, events)).toEqual([]);
  });

  it("only correlates sibling spans/tags sharing the same root_span_id", () => {
    const turn = guestTurn();
    const otherTurnSpan: BraintrustSpanEvent = {
      ...toolSpan("get_pricing", "{}", "{}"),
      root_span_id: "other-root",
    };

    expect(gatherToolsCalled(turn, [turn, otherTurnSpan])).toEqual([]);
  });
});

describe("formatToolsCalled", () => {
  it("renders the none-called placeholder for an empty list", () => {
    expect(formatToolsCalled([])).toBe("(none — no tool was called this turn)");
  });

  it("renders input/output for a span-derived entry", () => {
    const tools: ToolCallInfo[] = [{ name: "get_pricing", input: "{}", output: '{"price":100}' }];

    expect(formatToolsCalled(tools)).toBe('- get_pricing: input={}, output={"price":100}');
  });

  it("renders the tag-only placeholder for an entry with no input/output", () => {
    const tools: ToolCallInfo[] = [{ name: "missing_info" }];

    expect(formatToolsCalled(tools)).toBe(
      "- missing_info: (no logged input/output — detected via turn tag only)",
    );
  });

  it("joins multiple entries with newlines, one per line", () => {
    const tools: ToolCallInfo[] = [
      { name: "get_pricing", input: "{}", output: '{"price":100}' },
      { name: "send_booking_link" },
    ];

    expect(formatToolsCalled(tools)).toBe(
      '- get_pricing: input={}, output={"price":100}\n- send_booking_link: (no logged input/output — detected via turn tag only)',
    );
  });
});

describe("parseClassifierResponse", () => {
  it("parses a well-formed Reasoning/Choice response for each choice letter", () => {
    const a = parseClassifierResponse(
      "Reasoning: the right tool was called for the guest's question.\nChoice: A",
    );
    expect(a).toEqual({
      choice: "A",
      score: 1.0,
      reasoning: "the right tool was called for the guest's question.",
    });

    const b = parseClassifierResponse("Reasoning: a defensible extra call.\nChoice: B");
    expect(b.choice).toBe("B");
    expect(b.score).toBe(0.5);

    const c = parseClassifierResponse("Reasoning: the wrong tool was called.\nChoice: C");
    expect(c.choice).toBe("C");
    expect(c.score).toBe(0.0);
  });

  it("lowercases and multi-line reasoning still parse via the strict regex", () => {
    const result = parseClassifierResponse("Reasoning: line one.\nline two.\n\nChoice: a");
    expect(result.choice).toBe("A");
    expect(result.score).toBe(1.0);
    expect(result.reasoning).toBe("line one.\nline two.");
  });

  it("falls back to the loose split when Choice: isn't preceded by the strict newline shape", () => {
    const result = parseClassifierResponse("Some preamble text Choice: B trailing junk");
    expect(result.choice).toBe("B");
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toBe("Some preamble text");
  });

  it("returns an UNPARSEABLE mid-scale fallback when no choice can be found at all", () => {
    const result = parseClassifierResponse(
      "The model rambled without ever committing to a letter.",
    );

    expect(result.choice).toBe("UNPARSEABLE");
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain("Unparseable classifier response:");
    expect(result.reasoning).toContain("The model rambled without ever committing to a letter.");
  });
});
