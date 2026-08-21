import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConversationByIdMock = vi.fn();
const getLastOrphanedUserMessageMock = vi.fn();
vi.mock("@/lib/admin-conversations.js", () => ({
  getConversationById: getConversationByIdMock,
  getLastOrphanedUserMessage: getLastOrphanedUserMessageMock,
}));

// run-turn.ts's own module-level runGuestTurnFunction calls
// inngest.createFunction(...) at import time (it's a plain top-level const,
// not something deferred to request time) — importing GUEST_TURN_REQUESTED_EVENT
// from that module below pulls that call in too, so the mock needs a no-op
// createFunction alongside send, even though this route only ever calls send.
const inngestSendMock = vi.fn();
vi.mock("@/lib/inngest.js", () => ({
  inngest: { send: inngestSendMock, createFunction: vi.fn() },
}));

const { POST } = await import("@/app/api/admin/conversations/[id]/actions/retrigger-turn/route.js");
const { GUEST_TURN_REQUESTED_EVENT } = await import("@/agent/run-turn.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest(
    "http://localhost:3005/api/admin/conversations/convo-1/actions/retrigger-turn",
    { method: "POST", headers: { "X-API-Key": apiKey } },
  );
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/conversations/[id]/actions/retrigger-turn", () => {
  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    getConversationByIdMock.mockReset();
    getLastOrphanedUserMessageMock.mockReset();
    inngestSendMock.mockReset();
    inngestSendMock.mockResolvedValue({ ids: ["evt-1"] });
    getConversationByIdMock.mockResolvedValue({
      id: "convo-1",
      // Stored prefixed, as whatsapp_conversations.phone_number always is.
      phone: "whatsapp:+351920742845",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      closedAt: null,
    });
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest("wrong"), makeParams("convo-1"));
    expect(res.status).toBe(401);
    expect(getConversationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation doesn't exist", async () => {
    getConversationByIdMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams("convo-missing"));
    expect(res.status).toBe(404);
    expect(getLastOrphanedUserMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when there's no orphaned inbound message to retrigger", async () => {
    getLastOrphanedUserMessageMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "No orphaned inbound message to retrigger for this conversation",
    });
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("re-fires GUEST_TURN_REQUESTED_EVENT with a fresh correlationId, the normalized phone, and the orphaned message's content/id", async () => {
    getLastOrphanedUserMessageMock.mockResolvedValueOnce({
      id: "msg-orphan-1",
      role: "user",
      content: "Is room 1 free?",
      createdAt: "2026-08-01T00:00:00.000Z",
      deliveryStatus: null,
    });

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.correlationId).toBe("string");

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: GUEST_TURN_REQUESTED_EVENT,
      data: expect.objectContaining({
        conversationId: "convo-1",
        // Normalized: no "whatsapp:" prefix, even though the conversation's
        // own stored phone_number is prefixed.
        phone: "+351920742845",
        incomingMessage: "Is room 1 free?",
        triggerMessageId: "msg-orphan-1",
        correlationId: json.correlationId,
      }),
    });
  });

  it("returns a 500 with the error message when a query fails", async () => {
    getLastOrphanedUserMessageMock.mockRejectedValueOnce(new Error("db boom"));

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db boom" });
  });
});
