import { AIMessage, type ToolMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphStateType } from "@/graph/state.js";

// Same "mock the module boundary, not the network" convention as
// tests/graph/graph.unit.test.ts's own mocks — escalateToOwnerNode invokes
// the real escalateToOwner tool (@/graph/tools.ts), which calls
// performEscalation, which talks to Supabase and telegram-router.
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(),
  // ../tools/search-property.ts also imports createClient() at module load
  // time (its own singleton pattern) — must be present here too, same
  // reasoning as graph.unit.test.ts's own supabase mock.
  createClient: vi.fn(),
}));
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: vi.fn(),
}));

const { createAdminClient } = await import("@/lib/supabase.js");
const { sendEscalationNudge } = await import("@/lib/telegram-router.js");
const { escalateToOwnerNode } = await import("@/graph/nodes/tool-nodes.js");

// escalateToOwnerNode is its own standalone function (not built via the
// shared makeToolNode factory the other four tool nodes use) specifically so
// it can inspect the tool call's own reason_category arg and surface
// missingInfoEscalated — see tool-nodes.ts's own doc comment on why. These
// tests cover that new behavior: true only for missing_info, false/omitted
// for the other three escalation categories (whose guest-facing behavior
// must stay untouched).
describe("escalateToOwnerNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "esc-1" }, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert, update: mockUpdate }),
    } as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(sendEscalationNudge).mockResolvedValue({ ok: true, telegramMessageId: 555 });
  });

  function stateWithEscalateCall(reasonCategory: string): GraphStateType {
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "escalateToOwner",
              args: { reason: "Guest asked something", reason_category: reasonCategory },
              id: "call_1",
            },
          ],
        }),
      ],
      conversationId: "convo-1",
      phone: "+351900000001",
      guestContext: null,
      stepCount: 1,
    } as GraphStateType;
  }

  it("returns missingInfoEscalated: true for reason_category missing_info", async () => {
    const result = await escalateToOwnerNode(stateWithEscalateCall("missing_info"), {});

    expect(result.missingInfoEscalated).toBe(true);
    expect(result.messages).toHaveLength(1);
    const [message] = result.messages as ToolMessage[];
    expect(message.tool_call_id).toBe("call_1");
    expect(message.name).toBe("escalateToOwner");
  });

  it.each(["unhappy_guest", "wants_human", "complaint"])(
    "returns missingInfoEscalated: false for reason_category %s",
    async (reasonCategory) => {
      const result = await escalateToOwnerNode(stateWithEscalateCall(reasonCategory), {});

      expect(result.missingInfoEscalated).toBe(false);
      expect(result.messages).toHaveLength(1);
    },
  );

  it("throws when invoked with no matching tool_call on the last AIMessage", async () => {
    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "getPricing", args: {}, id: "call_1" }],
        }),
      ],
      conversationId: "convo-1",
      phone: "+351900000001",
      guestContext: null,
      stepCount: 1,
    } as GraphStateType;

    await expect(escalateToOwnerNode(state, {})).rejects.toThrow(/no matching tool_call/);
  });
});
