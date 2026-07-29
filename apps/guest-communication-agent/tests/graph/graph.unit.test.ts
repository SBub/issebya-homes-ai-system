import { AIMessage, HumanMessage, type ToolMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { graph } from "@/graph/graph.js";
import { agentNode } from "@/graph/nodes/agent.js";
import { loadContext } from "@/graph/nodes/load-context.js";
import { getPricingNode, routeToToolNodes } from "@/graph/nodes/tool-nodes.js";
import type { GraphStateType } from "@/graph/state.js";

// Ported from issebya-homes-website's
// apps/guest-communication-agent/src/graph/__tests__/graph.unit.test.ts —
// moved into this repo's tests/ convention (co-located __tests__ there vs.
// a top-level tests/ dir mirroring src/ here, matching every other app in
// this monorepo). Mock import path updated: that repo's
// @issebya/shared/supabase -> this repo's @/lib/supabase.
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(),
  // ../tools/search-property.ts also imports createClient() at module load
  // time (its own singleton pattern) — must be present here too or the
  // whole mock factory replaces the module with just createAdminClient,
  // leaving createClient undefined and crashing that unrelated import chain.
  createClient: vi.fn(),
}));
// Every escalation category (the agentNode step-cap test below produces a
// missing_info one) routes its owner notification through telegram-router
// now — see @/graph/tools.ts's performEscalation. The old raw
// sendTelegramNotification bypass (@/lib/telegram.ts) is deleted.
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: vi.fn(),
}));
// loadGuestInfo (@/lib/db.ts) no longer queries Supabase directly — the
// guest_contacts table now lives in apps/crm, and db.ts calls
// @/lib/crm.ts's lookupGuestContact() over HTTP instead. Mock that function
// here rather than a guest_contacts Supabase table, so the "loadContext
// ordering" tests below still control what loadGuestInfo returns without
// making a real network call.
vi.mock("@/lib/crm.js", () => ({
  lookupGuestContact: vi.fn(),
}));

const { createAdminClient } = await import("@/lib/supabase.js");
const { sendEscalationNudge } = await import("@/lib/telegram-router.js");
const { lookupGuestContact } = await import("@/lib/crm.js");

// Proves the graph compiles and is structurally sound — nodes/edges wired
// as expected — without invoking .invoke() against a real LLM. No
// OPENROUTER_API_KEY/LANGSMITH_API_KEY needed: ChatOpenAI's constructor
// doesn't validate credentials until an actual network call is made.
describe("whatsapp-agent graph", () => {
  it("compiles with the expected nodes", () => {
    const nodeNames = Object.keys(graph.nodes);

    expect(nodeNames).toContain("load_context");
    expect(nodeNames).toContain("agent");
    // Node id is 'getPricingStub' (not 'getPricing') — the tool still
    // returns hardcoded PRICING data, so its node is named to make that
    // obvious. The tool's own LLM-facing name is unaffected.
    expect(nodeNames).toContain("getPricingStub");
    expect(nodeNames).toContain("checkAvailability");
    expect(nodeNames).toContain("sendBookingLink");
    expect(nodeNames).toContain("answerPropertyQuestion");
    expect(nodeNames).toContain("escalateToOwner");
    // No more single collapsed "tools" box — each tool is its own node.
    expect(nodeNames).not.toContain("tools");
  });

  it("exposes a runnable graph representation", () => {
    const drawable = graph.getGraph();
    const nodeIds = Object.keys(drawable.nodes);

    expect(nodeIds).toContain("__start__");
    expect(nodeIds).toContain("load_context");
    expect(nodeIds).toContain("agent");
    expect(nodeIds).toContain("getPricingStub");
    expect(nodeIds).toContain("checkAvailability");
    expect(nodeIds).toContain("sendBookingLink");
    expect(nodeIds).toContain("answerPropertyQuestion");
    expect(nodeIds).toContain("escalateToOwner");
    expect(nodeIds).toContain("__end__");
  });
});

// Direct, no-LLM tests for the routing/dispatch plumbing introduced to
// replace the single shared ToolNode + toolsCondition.
describe("routeToToolNodes", () => {
  it("routes a getPricing tool_call to the getPricingStub node", () => {
    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "getPricing", args: { room: "room1" }, id: "call_1" }],
        }),
      ],
    } as GraphStateType;

    expect(routeToToolNodes(state)).toEqual(["getPricingStub"]);
  });

  it("fans out to every matching tool node when the model calls more than one tool", () => {
    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "getPricing", args: { room: "room1" }, id: "call_1" },
            {
              name: "checkAvailability",
              args: {
                room: "room1",
                checkIn: "2026-08-01",
                checkOut: "2026-08-05",
              },
              id: "call_2",
            },
          ],
        }),
      ],
    } as GraphStateType;

    expect(routeToToolNodes(state)).toEqual(["getPricingStub", "checkAvailability"]);
  });

  it("routes to END when there are no tool calls", () => {
    const state = {
      messages: [new AIMessage({ content: "Hello!" })],
    } as GraphStateType;

    expect(routeToToolNodes(state)).toBe(END);
  });
});

describe("getPricingNode", () => {
  it("invokes the getPricing tool and returns a ToolMessage for the matching tool_call", async () => {
    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "getPricing", args: { room: "room1" }, id: "call_123" }],
        }),
      ],
    } as GraphStateType;

    const result = await getPricingNode(state, {});

    expect(result.messages).toHaveLength(1);
    const [message] = result.messages as ToolMessage[];
    expect(message.tool_call_id).toBe("call_123");
    expect(message.name).toBe("getPricing");
    const content = JSON.parse(message.content as string);
    expect(content).toMatchObject({ room: "room1", currency: "EUR" });
  });

  it("throws when invoked with no matching tool_call on the last AIMessage", async () => {
    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "checkAvailability", args: {}, id: "call_1" }],
        }),
      ],
    } as GraphStateType;

    await expect(getPricingNode(state, {})).rejects.toThrow(/no matching tool_call/);
  });
});

describe("agentNode step cap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("escalates instead of calling the model once MAX_AGENT_STEPS is exceeded", async () => {
    // missing_info escalations insert-then-select the new row's id (needed
    // to correlate the owner's later Telegram reply — see
    // @/graph/tools.ts's performEscalation), then update it once the nudge
    // has an id of its own — unlike the other two categories' plain
    // fire-and-forget insert, so this mock chains insert().select().single()
    // and a separate update().eq().
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: "esc-cap-test" }, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert, update: mockUpdate }),
    } as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(sendEscalationNudge).mockResolvedValue({ ok: true, telegramMessageId: 4242 });

    const state = {
      messages: [new AIMessage({ content: "looping..." })],
      conversationId: "convo-cap-test",
      phone: "+351900000099",
      incomingMessage: "Is there a juicer in the kitchen?",
      guestContext: null,
      // Already at the cap — this call would be round 9, one past MAX_AGENT_STEPS (8).
      stepCount: 8,
    } as GraphStateType;

    // No OPENROUTER_API_KEY/LANGSMITH_API_KEY is set in the test environment —
    // if this branch fell through to a real model/prompt-pull call, the
    // promise would reject with a network/auth error instead of resolving
    // cleanly, so a clean resolution here is itself proof the model was
    // never invoked.
    const result = await agentNode(state, {});

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "convo-cap-test",
        phone_number: "+351900000099",
        // Deterministic safety-net escalation, not a model tool call — see
        // agent.ts's own comment on why missing_info is the closest fit of
        // the three categories for this path.
        reason_category: "missing_info",
        // The owner-facing reason must include the guest's real question,
        // not just a generic technical description of the failure mode —
        // see agent.ts's own comment on this.
        reason: expect.stringContaining('Guest asked: "Is there a juicer in the kitchen?"'),
      }),
    );
    // Every category (missing_info included) now routes through
    // telegram-router's nudge endpoint — the old raw sendTelegramNotification
    // bypass is deleted entirely.
    expect(sendEscalationNudge).toHaveBeenCalledWith(
      expect.objectContaining({
        escalationId: "esc-cap-test",
        phone: "+351900000099",
        reasonCategory: "missing_info",
        conversationId: "convo-cap-test",
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ telegram_message_id: 4242 });

    expect(result.messages).toHaveLength(1);
    const [message] = result.messages as AIMessage[];
    expect(message.tool_calls ?? []).toHaveLength(0);
    expect(message.content).toMatch(/owner/i);
    expect(result.stepCount).toBe(9);
    // Signals the webhook route to suppress this interim message from ever
    // reaching the guest — see state.ts's missingInfoEscalated doc comment.
    expect(result.missingInfoEscalated).toBe(true);
  });
});

// Builds a fake createAdminClient() return value that answers
// .from('whatsapp_messages')...limit() with fixed data — the query
// loadRecentMessages (@/lib/db.ts) issues. loadGuestInfo's data no longer
// comes from Supabase (see @/lib/crm.js mock above), so this only needs to
// cover the whatsapp_messages table now.
function makeSupabaseMock(options: {
  messageRows: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "whatsapp_messages") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: options.messageRows, error: null }),
        };
      }
      throw new Error(`makeSupabaseMock: unexpected table "${table}"`);
    }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

// No-LLM test for load_context's message-conversion/ordering logic — the
// specific bug this graph's design has to avoid (see state.ts's
// incomingMessage comment): with MessagesAnnotation's append-only reducer,
// getting this wrong would silently produce [newMessage, ...history] instead
// of [...history, newMessage].
describe("loadContext ordering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns prior history (oldest first) followed by the new incoming message last", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseMock({
        // loadRecentMessages queries created_at DESC (to actually get the most
        // recent N messages of a long conversation) then reverses the result
        // back to ascending — so this fixture simulates what the DB itself
        // returns (newest first), not the final expected order.
        messageRows: [
          { role: "user", content: "Great, what does it cost?" },
          {
            role: "assistant",
            content: "Yes! Room 1 is open for most of August.",
          },
          { role: "user", content: "Hi, do you have room 1 free in August?" },
        ],
      }),
    );
    vi.mocked(lookupGuestContact).mockResolvedValue({
      found: true,
      last_room: "room_2",
      last_stay_checkin: "2025-09-28",
      total_stays: 1,
    });

    const state = {
      conversationId: "convo-1",
      phone: "+351900000001",
      incomingMessage: "Also, is breakfast included?",
      messages: [],
      guestContext: null,
      stepCount: 0,
      missingInfoEscalated: false,
    } as GraphStateType;

    const result = await loadContext(state);

    expect(result.messages).toHaveLength(4);
    const [m1, m2, m3, m4] = result.messages as GraphStateType["messages"];

    expect(m1).toBeInstanceOf(HumanMessage);
    expect(m1.content).toBe("Hi, do you have room 1 free in August?");
    expect(m2).toBeInstanceOf(AIMessage);
    expect(m2.content).toBe("Yes! Room 1 is open for most of August.");
    expect(m3).toBeInstanceOf(HumanMessage);
    expect(m3.content).toBe("Great, what does it cost?");
    // The turn's new message must land last, not first — proves the
    // ordering described in state.ts's incomingMessage comment holds.
    expect(m4).toBeInstanceOf(HumanMessage);
    expect(m4.content).toBe("Also, is breakfast included?");

    expect(result.guestContext).toMatch(/room_2/);
    expect(result.guestContext).toMatch(/2025-09-28/);
  });

  it("returns just the new message and null guestContext for a phone with no history/no guest_contacts row", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabaseMock({ messageRows: [] }));
    vi.mocked(lookupGuestContact).mockResolvedValue({ found: false });

    const state = {
      conversationId: "convo-fresh",
      phone: "+351900000002",
      incomingMessage: "Hello, is room 2 available next week?",
      messages: [],
      guestContext: null,
      stepCount: 0,
      missingInfoEscalated: false,
    } as GraphStateType;

    const result = await loadContext(state);

    expect(result.messages).toHaveLength(1);
    const [message] = result.messages as GraphStateType["messages"];
    expect(message).toBeInstanceOf(HumanMessage);
    expect(message.content).toBe("Hello, is room 2 available next week?");
    expect(result.guestContext).toBeNull();
  });
});
