import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConversationByIdMock = vi.fn();
const getLastFailedDeliveryMessageMock = vi.fn();
vi.mock("@/lib/admin-conversations.js", () => ({
  getConversationById: getConversationByIdMock,
  getLastFailedDeliveryMessage: getLastFailedDeliveryMessageMock,
}));

const updateMessageDeliveryStatusMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  updateMessageDeliveryStatus: updateMessageDeliveryStatusMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const { POST } = await import("@/app/api/admin/conversations/[id]/actions/retry-send/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest(
    "http://localhost:3005/api/admin/conversations/convo-1/actions/retry-send",
    { method: "POST", headers: { "X-API-Key": apiKey } },
  );
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/conversations/[id]/actions/retry-send", () => {
  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    getConversationByIdMock.mockReset();
    getLastFailedDeliveryMessageMock.mockReset();
    updateMessageDeliveryStatusMock.mockReset();
    sendWhatsAppMessageMock.mockReset();
    getConversationByIdMock.mockResolvedValue({
      id: "convo-1",
      phone: "+351920742845",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      closedAt: null,
    });
    updateMessageDeliveryStatusMock.mockResolvedValue(undefined);
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
    expect(getLastFailedDeliveryMessageMock).not.toHaveBeenCalled();
  });

  it("returns 400 when there's no failed-delivery message to retry", async () => {
    getLastFailedDeliveryMessageMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "No failed-delivery message to retry for this conversation" });
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  it("resends the failed message and marks it 'sent' on success", async () => {
    getLastFailedDeliveryMessageMock.mockResolvedValueOnce({
      id: "msg-1",
      role: "assistant",
      content: "Yes, room 1 is available!",
      createdAt: "2026-08-01T00:00:00.000Z",
      deliveryStatus: "failed",
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
      "+351920742845",
      "Yes, room 1 is available!",
    );
    expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-1", "sent");
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, messageId: "msg-1", deliveryStatus: "sent" });
  });

  it("marks the message 'failed' again and reports ok: false when the retry also fails", async () => {
    getLastFailedDeliveryMessageMock.mockResolvedValueOnce({
      id: "msg-1",
      role: "assistant",
      content: "Yes, room 1 is available!",
      createdAt: "2026-08-01T00:00:00.000Z",
      deliveryStatus: "failed",
    });
    sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: false, error: "Twilio rejected it" });

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-1", "failed");
    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: false,
      messageId: "msg-1",
      deliveryStatus: "failed",
      error: "Twilio rejected it",
    });
  });

  it("returns a 500 with the error message when a query fails", async () => {
    getLastFailedDeliveryMessageMock.mockRejectedValueOnce(new Error("db boom"));

    const res = await POST(makeRequest(), makeParams("convo-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db boom" });
  });
});
