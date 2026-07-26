import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for both Supabase (routed by table name — this
// route now touches escalations, documents, AND whatsapp_messages, the last
// one only to look up trigger_message_id's content for the re-invocation
// path) and the embedding call — same "mock the shared factory, not the
// network" approach as every other route test in this app, plus a stub for
// ai's embed() so no real OpenRouter call happens, and a stub for
// resumeConversationWithAnswer so no real graph.invoke()/Twilio send happens.
const maybeSingleMock = vi.fn();
const eqSelectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqSelectMock }));

const insertMock = vi.fn();

const eqUpdateMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqUpdateMock }));

const triggerMessageMaybeSingleMock = vi.fn();
const triggerMessageEqMock = vi.fn(() => ({ maybeSingle: triggerMessageMaybeSingleMock }));
const triggerMessageSelectMock = vi.fn(() => ({ eq: triggerMessageEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "escalations") {
    return { select: selectMock, update: updateMock };
  }
  if (table === "documents") {
    return { insert: insertMock };
  }
  if (table === "whatsapp_messages") {
    return { select: triggerMessageSelectMock };
  }
  throw new Error(`resolve route test: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const embedMock = vi.fn();
vi.mock("ai", () => ({ embed: embedMock }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
}));

const resumeConversationWithAnswerMock = vi.fn();
vi.mock("@/lib/resume-conversation.js", () => ({
  resumeConversationWithAnswer: resumeConversationWithAnswerMock,
}));

const { POST } = await import("@/app/api/escalations/[id]/resolve/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/escalations/esc-1/resolve", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/escalations/[id]/resolve", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    maybeSingleMock.mockReset();
    eqSelectMock.mockClear();
    selectMock.mockClear();
    insertMock.mockReset();
    eqUpdateMock.mockReset();
    updateMock.mockClear();
    fromMock.mockClear();
    embedMock.mockReset();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    insertMock.mockResolvedValue({ error: null });
    eqUpdateMock.mockResolvedValue({ error: null });
    triggerMessageMaybeSingleMock.mockReset();
    triggerMessageEqMock.mockClear();
    triggerMessageSelectMock.mockClear();
    resumeConversationWithAnswerMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }, "wrong-key"),
      makeParams("esc-1"),
    );
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing answer in request body" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is whitespace-only", async () => {
    const res = await POST(makeRequest({ answer: "   " }), makeParams("esc-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no such escalation exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("missing"),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Escalation not found" });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the escalation isn't a missing_info category", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "wants_human", resolved_at: null },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing_info/);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the escalation is already resolved", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "missing_info", resolved_at: "2026-07-25T10:00:00Z" },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "Escalation already resolved" });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message on a Supabase select error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("embeds the answer, inserts into documents, resolves the escalation, and returns ok:true, sentToGuest:false when there's no trigger_message_id", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        trigger_message_id: null,
        conversation_id: "convo-1",
        phone_number: "+351920742845",
      },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Graceful skip: an escalation from before trigger_message_id existed
    // (or a deterministic safety-net one lacking a clean trigger message)
    // still resolves successfully — it just never re-invokes the graph.
    expect(json).toEqual({ ok: true, sentToGuest: false });

    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );

    expect(fromMock).toHaveBeenCalledWith("documents");
    expect(insertMock).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_escalation_answer", escalation_id: "esc-1" },
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "The AC is above the bed" }),
    );
    expect(eqUpdateMock).toHaveBeenCalledWith("id", "esc-1");
    expect(fromMock).not.toHaveBeenCalledWith("whatsapp_messages");
    expect(resumeConversationWithAnswerMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message when the documents insert fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        trigger_message_id: null,
        conversation_id: "convo-1",
        phone_number: "+351920742845",
      },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: { message: "insert boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message when the escalations update fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        trigger_message_id: null,
        conversation_id: "convo-1",
        phone_number: "+351920742845",
      },
      error: null,
    });
    eqUpdateMock.mockResolvedValueOnce({ error: { message: "update boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "update boom" });
  });

  // Everything below exercises the new re-invocation path: a missing_info
  // escalation WITH a trigger_message_id resolved via
  // resumeConversationWithAnswer (@/lib/resume-conversation.ts) instead of
  // the old sendGuestMessage relay.
  describe("with a trigger_message_id", () => {
    function mockEscalationWithTrigger() {
      maybeSingleMock.mockResolvedValueOnce({
        data: {
          id: "esc-1",
          reason_category: "missing_info",
          resolved_at: null,
          trigger_message_id: "msg-1",
          conversation_id: "convo-1",
          phone_number: "+351920742845",
        },
        error: null,
      });
    }

    it("looks up the trigger message's content and calls resumeConversationWithAnswer, returning sentToGuest:true on success", async () => {
      mockEscalationWithTrigger();
      triggerMessageMaybeSingleMock.mockResolvedValueOnce({
        data: { content: "Is there a swimming pool?" },
        error: null,
      });
      resumeConversationWithAnswerMock.mockResolvedValueOnce({ ok: true });

      const res = await POST(
        makeRequest({ answer: "The AC is above the bed" }),
        makeParams("esc-1"),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, sentToGuest: true });
      expect(fromMock).toHaveBeenCalledWith("whatsapp_messages");
      expect(triggerMessageSelectMock).toHaveBeenCalledWith("content");
      expect(triggerMessageEqMock).toHaveBeenCalledWith("id", "msg-1");
      expect(resumeConversationWithAnswerMock).toHaveBeenCalledWith({
        conversationId: "convo-1",
        phone: "+351920742845",
        triggerMessageContent: "Is there a swimming pool?",
      });
    });

    it("returns ok:true, sentToGuest:false when resumeConversationWithAnswer itself fails", async () => {
      mockEscalationWithTrigger();
      triggerMessageMaybeSingleMock.mockResolvedValueOnce({
        data: { content: "Is there a swimming pool?" },
        error: null,
      });
      resumeConversationWithAnswerMock.mockResolvedValueOnce({
        ok: false,
        error: "Twilio send failed",
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({ answer: "The AC is above the bed" }),
        makeParams("esc-1"),
      );
      const json = await res.json();

      // The escalation is still durably resolved (KB write + resolved_at
      // already happened above) even though the guest-facing reply failed.
      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, sentToGuest: false });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("skips the re-invocation gracefully when the trigger message row can't be found", async () => {
      mockEscalationWithTrigger();
      triggerMessageMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({ answer: "The AC is above the bed" }),
        makeParams("esc-1"),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, sentToGuest: false });
      expect(resumeConversationWithAnswerMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("skips the re-invocation gracefully when the whatsapp_messages select itself errors", async () => {
      mockEscalationWithTrigger();
      triggerMessageMaybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: "boom" },
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(
        makeRequest({ answer: "The AC is above the bed" }),
        makeParams("esc-1"),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true, sentToGuest: false });
      expect(resumeConversationWithAnswerMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
