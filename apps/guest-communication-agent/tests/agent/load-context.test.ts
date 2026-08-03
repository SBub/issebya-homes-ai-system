import { beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" convention as the rest
// of tests/agent/.
vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: vi.fn(),
}));
// loadGuestInfo (@/lib/db.ts) calls @/lib/crm.ts's lookupGuestContact() over
// HTTP rather than querying Supabase directly — mock that function here so
// these tests control what it returns without a real network call.
vi.mock("@/lib/crm.js", () => ({
  lookupGuestContact: vi.fn(),
}));

const { createAdminClient } = await import("@/lib/supabase.js");
const { lookupGuestContact } = await import("@/lib/crm.js");
const { loadContext } = await import("@/agent/load-context.js");

// Builds a fake createAdminClient() return value that answers
// .from('whatsapp_messages')...limit() with fixed data — the query
// loadRecentMessages (@/lib/db.ts) issues.
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

// No-LLM test for loadContext's message-conversion/ordering logic. Unlike
// the old LangGraph port (see git history), loadContext here only returns
// the prior history — appending the turn's new incoming message is
// run-turn.ts's own job now (`[...historyMessages, new
// HumanMessage(incomingMessage)]`), so this only needs to prove the history
// itself comes back oldest-first.
describe("loadContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns prior history oldest-first and guestContext from guest_contacts", async () => {
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

    const result = await loadContext({ conversationId: "convo-1", phone: "+351900000001" });

    expect(result.historyMessages).toHaveLength(3);
    const [m1, m2, m3] = result.historyMessages;

    expect(m1).toEqual({ role: "user", content: "Hi, do you have room 1 free in August?" });
    expect(m2).toEqual({ role: "assistant", content: "Yes! Room 1 is open for most of August." });
    expect(m3).toEqual({ role: "user", content: "Great, what does it cost?" });

    expect(result.guestContext).toMatch(/room_2/);
    expect(result.guestContext).toMatch(/2025-09-28/);
  });

  it("returns empty history and null guestContext for a phone with no history/no guest_contacts row", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabaseMock({ messageRows: [] }));
    vi.mocked(lookupGuestContact).mockResolvedValue({ found: false });

    const result = await loadContext({ conversationId: "convo-fresh", phone: "+351900000002" });

    expect(result.historyMessages).toHaveLength(0);
    expect(result.guestContext).toBeNull();
  });
});
