import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary" approach as the rest of tests/agent/ —
// this file isolates performEscalation itself rather than driving it
// indirectly through runAgentTurn's step-cap branch.
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn(() => ({ select: mockSelect }));
const mockEq = vi.fn();
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ insert: mockInsert, update: mockUpdate }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: mockFrom }),
  // ../../tools/search-property.ts imports createClient() at module load
  // time (its own singleton pattern) — must be present here too, same
  // reasoning as run-turn.test.ts's own supabase mock.
  createClient: vi.fn(),
}));

const sendEscalationNudgeMock = vi.fn();
vi.mock("@/lib/telegram-router.js", () => ({
  sendEscalationNudge: sendEscalationNudgeMock,
}));

const { performEscalation } = await import("@/agent/tools/escalation.js");

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

  // All three categories share the exact same insert -> nudge ->
  // store-telegram_message_id path — see @/agent/tools/escalation.ts's
  // performEscalation doc comment.
  for (const reasonCategory of ["wants_human", "complaint", "missing_info"] as const) {
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

  // wants_human is auto-resolved the instant it's created (no owner action
  // left to wait for — the system prompt already handles its guest-facing
  // side); complaint and missing_info both leave resolved_at unset, though
  // for different reasons — missing_info's resolution genuinely depends on
  // a later owner reply (see resume-conversation.ts's real HITL flow), while
  // complaint awaits a resolution mechanism the owner hasn't decided on yet
  // ("it shouldn't be resolved automatically for now, I don't yet know how
  // to resolve this").
  it("inserts wants_human escalations with resolved_at already set", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    mockEq.mockResolvedValueOnce({ error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true, telegramMessageId: 777 });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is upset about noise",
      reasonCategory: "wants_human",
    });

    expect(mockInsert).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      phone_number: "+351920742845",
      reason: "Guest is upset about noise",
      reason_category: "wants_human",
      resolved_at: expect.any(String),
    });
  });

  it("inserts complaint escalations without resolved_at (left unset — no resolution mechanism decided yet)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    mockEq.mockResolvedValueOnce({ error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true, telegramMessageId: 777 });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is upset about noise",
      reasonCategory: "complaint",
    });

    // toHaveBeenCalledWith does a deep-equal on the whole object, so this
    // also proves resolved_at is absent from the insert payload — were it
    // present (with any value), this exact-shape match would fail.
    expect(mockInsert).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      phone_number: "+351920742845",
      reason: "Guest is upset about noise",
      reason_category: "complaint",
    });
  });

  it("inserts missing_info escalations without resolved_at (left unset for the real owner-reply HITL flow)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    mockEq.mockResolvedValueOnce({ error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true, telegramMessageId: 777 });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is asking about the AC",
      reasonCategory: "missing_info",
    });

    // toHaveBeenCalledWith does a deep-equal on the whole object, so this
    // also proves resolved_at is absent from the insert payload — were it
    // present (with any value), this exact-shape match would fail.
    expect(mockInsert).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      phone_number: "+351920742845",
      reason: "Guest is asking about the AC",
      reason_category: "missing_info",
    });
  });

  it("includes trigger_message_id in the escalations insert when supplied", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "esc-1" }, error: null });
    mockEq.mockResolvedValueOnce({ error: null });
    sendEscalationNudgeMock.mockResolvedValueOnce({ ok: true, telegramMessageId: 777 });

    await performEscalation({
      conversationId: "convo-1",
      phone: "+351920742845",
      reason: "Guest is asking about the AC",
      reasonCategory: "missing_info",
      triggerMessageId: "msg-1",
    });

    expect(mockInsert).toHaveBeenCalledWith({
      conversation_id: "convo-1",
      phone_number: "+351920742845",
      reason: "Guest is asking about the AC",
      reason_category: "missing_info",
      trigger_message_id: "msg-1",
    });
  });

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
