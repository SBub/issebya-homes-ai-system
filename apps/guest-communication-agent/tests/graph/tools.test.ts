import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary" approach as tests/graph/graph.unit.test.ts's
// own createAdminClient/telegram-router mocks — this file isolates
// performEscalation itself rather than driving it indirectly through
// agentNode's step-cap branch.
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn(() => ({ select: mockSelect }));
const mockEq = vi.fn();
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
  // ../tools/search-property.ts imports createClient() at module load time
  // (its own singleton pattern) — must be present here too, same reasoning
  // as graph.unit.test.ts's own supabase mock.
  createClient: vi.fn(),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

const { performEscalation } = await import("@/graph/tools.js");

describe("performEscalation", () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockSelect.mockClear();
    mockInsert.mockClear();
    mockEq.mockReset();
    mockUpdate.mockClear();
    mockFrom.mockClear();
    sendEscalationNudgeMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // All four categories now share the exact same insert -> nudge ->
  // store-telegram_message_id path — see @/graph/tools.ts's performEscalation
  // doc comment for why the old two-branch shape (missing_info vs. the
  // other three via a raw sendTelegramNotification bypass) was unified.
  for (const reasonCategory of [
    "unhappy_guest",
    "wants_human",
    "complaint",
    "missing_info",
  ] as const) {
    it(`inserts, nudges via telegram-router, and stores telegram_message_id for ${reasonCategory}`, async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
      mockEq.mockResolvedValueOnce({ error: null });
      sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true, telegramMessageId: 777 });

      await performEscalation({
        conversationId: "convo-1",
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
      });

      expect(mockFrom).toHaveBeenCalledWith("escalations");
      expect(mockInsert).toHaveBeenCalledWith({
        conversation_id: "convo-1",
        phone_number: "+351920742845",
        reason: "Guest is upset about noise",
        reason_category: reasonCategory,
      });
      expect(mockSelect).toHaveBeenCalledWith("id");
      expect(sendEscalationNudgeMock).toHaveBeenCalledWith({
        escalationId: "esc-1",
        phone: "+351920742845",
        reason: "Guest is upset about noise",
        reasonCategory,
        conversationId: "convo-1",
      });
      expect(mockUpdate).toHaveBeenCalledWith({ telegram_message_id: 777 });
      expect(mockEq).toHaveBeenCalledWith("id", "esc-1");
    });
  }

  it("skips the nudge (and logs) when the escalations insert itself fails", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest asked something unanswerable",
      reasonCategory: "missing_info",
    });

    expect(sendEscalationNudgeMock).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("does not store telegram_message_id when the nudge fails", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: false, error: "telegram-router down" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest asked something unanswerable",
      reasonCategory: "missing_info",
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("does not store telegram_message_id when the nudge succeeds without one (telegram-router not configured)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest asked something unanswerable",
      reasonCategory: "missing_info",
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
