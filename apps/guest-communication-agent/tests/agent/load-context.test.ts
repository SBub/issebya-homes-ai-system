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
const { KEEP_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS, estimateTokens } = await import(
  "@/agent/context.js"
);

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

// loadContext only returns prior history — appending the new incoming
// message is run-turn.ts's job — so this only needs to prove the history
// comes back oldest-first.
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

  // Token-budget-driven history loading (replaces the old fixed
  // RECENT_MESSAGE_LIMIT row cliff — see ../../src/lib/db.ts and
  // ../../src/agent/context.ts).
  describe("token-budget trimming", () => {
    it("keeps a conversation that fits comfortably under MAX_CONTEXT_TOKENS in full", async () => {
      // 20 short messages, nowhere near MAX_CONTEXT_TOKENS (3000) — should
      // come back untrimmed, same as pre-token-budget behavior.
      const oldestFirst = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `message ${i}`,
      }));
      // loadRecentMessages fetches DESC then reverses to ascending, so the
      // mock must hand back rows newest-first (see makeSupabaseMock's own
      // comment above).
      const newestFirst = [...oldestFirst].reverse();

      vi.mocked(createAdminClient).mockReturnValue(makeSupabaseMock({ messageRows: newestFirst }));
      vi.mocked(lookupGuestContact).mockResolvedValue({ found: false });

      const result = await loadContext({ conversationId: "convo-short", phone: "+351900000003" });

      expect(
        estimateTokens(oldestFirst as unknown as Parameters<typeof estimateTokens>[0]),
      ).toBeLessThan(MAX_CONTEXT_TOKENS);
      expect(result.historyMessages).toHaveLength(20);
      expect(result.historyMessages[0]).toEqual({ role: "user", content: "message 0" });
      expect(result.historyMessages[19]).toEqual({ role: "assistant", content: "message 19" });
    });

    it("trims a conversation that exceeds MAX_CONTEXT_TOKENS down to under KEEP_CONTEXT_TOKENS, dropping oldest first", async () => {
      // 40 messages of 400 chars (~100 tokens) each -> ~4000 tokens total,
      // over MAX_CONTEXT_TOKENS (3000). Only the most recent 15 (~1500
      // tokens) fit under KEEP_CONTEXT_TOKENS (1500).
      const padding = "x".repeat(390);
      const oldestFirst = Array.from({ length: 40 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `m${i}:${padding}`,
      }));
      const newestFirst = [...oldestFirst].reverse();

      vi.mocked(createAdminClient).mockReturnValue(makeSupabaseMock({ messageRows: newestFirst }));
      vi.mocked(lookupGuestContact).mockResolvedValue({ found: false });

      const result = await loadContext({ conversationId: "convo-long", phone: "+351900000004" });

      expect(result.historyMessages.length).toBeLessThan(40);
      expect(result.historyMessages).toHaveLength(15);
      expect(estimateTokens(result.historyMessages)).toBeLessThanOrEqual(KEEP_CONTEXT_TOKENS);
      // Oldest 25 dropped, most recent 15 survive, still oldest-first among
      // themselves.
      expect(result.historyMessages[0]).toEqual({
        role: oldestFirst[25].role,
        content: oldestFirst[25].content,
      });
      expect(result.historyMessages[14]).toEqual({
        role: oldestFirst[39].role,
        content: oldestFirst[39].content,
      });
    });
  });
});
