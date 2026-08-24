import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPendingOwnerDecisionByIdMock = vi.fn();
const markPendingOwnerDecisionResolvedByIdMock = vi.fn();
vi.mock("@/lib/pending-owner-decisions.js", () => ({
  getPendingOwnerDecisionById: getPendingOwnerDecisionByIdMock,
  markPendingOwnerDecisionResolvedById: markPendingOwnerDecisionResolvedByIdMock,
}));

const recordMessageMock = vi.fn();
const updateMessageDeliveryStatusMock = vi.fn();
vi.mock("@/lib/conversations.js", () => ({
  recordMessage: recordMessageMock,
  updateMessageDeliveryStatus: updateMessageDeliveryStatusMock,
}));

const sendWhatsAppMessageMock = vi.fn();
vi.mock("@/lib/twilio-send.js", () => ({
  sendWhatsAppMessage: sendWhatsAppMessageMock,
}));

const runSendBookingLinkMock = vi.fn();
vi.mock("@/agent/tools/booking.js", () => ({
  runSendBookingLink: runSendBookingLinkMock,
}));

const { POST } = await import("@/app/api/admin/pending-decisions/[id]/actions/resolve/route.js");

function makeRequest(apiKey = "test-key"): NextRequest {
  return new NextRequest(
    "http://localhost:3005/api/admin/pending-decisions/decision-1/actions/resolve",
    { method: "POST", headers: { "X-API-Key": apiKey } },
  );
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const bookingRow = {
  id: "decision-1",
  correlationId: "corr-1",
  toolName: "send_booking_link" as const,
  conversationId: "convo-1",
  phone: "+351920742845",
  reason: "Ana wants to book room1 from 01-09-2026 to 05-09-2026.",
  context: {
    guestName: "Ana",
    email: "ana@example.com",
    room: "room1",
    checkIn: "2026-09-01",
    checkOut: "2026-09-05",
  },
  sentAt: "2026-08-01T00:00:00.000Z",
  relayedAt: "2026-08-01T00:10:00.000Z",
  resolvedAt: null,
  resolution: null,
};

const missingInfoRow = {
  id: "decision-2",
  correlationId: "corr-2",
  toolName: "missing_info" as const,
  conversationId: "convo-1",
  phone: "+351920742845",
  reason: "Guest asked about the sauna",
  context: { answer: "The sauna is on the ground floor." },
  sentAt: "2026-08-01T00:00:00.000Z",
  relayedAt: "2026-08-01T00:10:00.000Z",
  resolvedAt: null,
  resolution: null,
};

describe("POST /api/admin/pending-decisions/[id]/actions/resolve", () => {
  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    getPendingOwnerDecisionByIdMock.mockReset();
    markPendingOwnerDecisionResolvedByIdMock.mockReset();
    recordMessageMock.mockReset();
    updateMessageDeliveryStatusMock.mockReset();
    sendWhatsAppMessageMock.mockReset();
    runSendBookingLinkMock.mockReset();

    markPendingOwnerDecisionResolvedByIdMock.mockResolvedValue(undefined);
    recordMessageMock.mockResolvedValue("msg-new-1");
    updateMessageDeliveryStatusMock.mockResolvedValue(undefined);
    sendWhatsAppMessageMock.mockResolvedValue({ ok: true });
    runSendBookingLinkMock.mockResolvedValue({
      url: "https://issebya.com/booking?room=room1&checkIn=2026-09-01&checkOut=2026-09-05",
    });
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest("wrong"), makeParams("decision-1"));
    expect(res.status).toBe(401);
    expect(getPendingOwnerDecisionByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no row exists for this id", async () => {
    getPendingOwnerDecisionByIdMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest(), makeParams("decision-missing"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Pending owner decision not found" });
  });

  it("returns 409 when the row is already resolved", async () => {
    getPendingOwnerDecisionByIdMock.mockResolvedValueOnce({
      ...bookingRow,
      resolvedAt: "2026-08-01T01:00:00.000Z",
      resolution: "approved",
    });

    const res = await POST(makeRequest(), makeParams("decision-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("approved");
    expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
  });

  describe("send_booking_link", () => {
    it("rebuilds the booking URL from context, sends it, records it, and marks the row resolved", async () => {
      getPendingOwnerDecisionByIdMock.mockResolvedValueOnce(bookingRow);

      const res = await POST(makeRequest(), makeParams("decision-1"));
      const json = await res.json();

      expect(runSendBookingLinkMock).toHaveBeenCalledWith(
        {
          guestName: "Ana",
          email: "ana@example.com",
          room: "room1",
          checkIn: "2026-09-01",
          checkOut: "2026-09-05",
        },
        { phone: "+351920742845" },
      );
      expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
        "+351920742845",
        "https://issebya.com/booking?room=room1&checkIn=2026-09-01&checkOut=2026-09-05",
      );
      expect(recordMessageMock).toHaveBeenCalledWith(
        "convo-1",
        "assistant",
        "https://issebya.com/booking?room=room1&checkIn=2026-09-01&checkOut=2026-09-05",
      );
      expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-new-1", "sent");
      expect(markPendingOwnerDecisionResolvedByIdMock).toHaveBeenCalledWith(
        "decision-1",
        "manually_resolved",
      );
      expect(res.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        resolution: "manually_resolved",
        sentMessage:
          "https://issebya.com/booking?room=room1&checkIn=2026-09-01&checkOut=2026-09-05",
      });
    });

    it("returns 400 when context is missing room/checkIn/checkOut", async () => {
      getPendingOwnerDecisionByIdMock.mockResolvedValueOnce({ ...bookingRow, context: null });

      const res = await POST(makeRequest(), makeParams("decision-1"));

      expect(res.status).toBe(400);
      expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
      expect(markPendingOwnerDecisionResolvedByIdMock).not.toHaveBeenCalled();
    });

    it("does not mark the row resolved when the WhatsApp send fails", async () => {
      getPendingOwnerDecisionByIdMock.mockResolvedValueOnce(bookingRow);
      sendWhatsAppMessageMock.mockResolvedValueOnce({ ok: false, error: "Twilio rejected it" });

      const res = await POST(makeRequest(), makeParams("decision-1"));
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json).toEqual({ error: "Twilio rejected it" });
      expect(recordMessageMock).not.toHaveBeenCalled();
      expect(updateMessageDeliveryStatusMock).not.toHaveBeenCalled();
      expect(markPendingOwnerDecisionResolvedByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("missing_info", () => {
    it("sends a plain-text message containing the captured answer, records it, and marks the row resolved", async () => {
      getPendingOwnerDecisionByIdMock.mockResolvedValueOnce(missingInfoRow);

      const res = await POST(makeRequest(), makeParams("decision-2"));
      const json = await res.json();

      expect(sendWhatsAppMessageMock).toHaveBeenCalledWith(
        "+351920742845",
        expect.stringContaining("The sauna is on the ground floor."),
      );
      expect(recordMessageMock).toHaveBeenCalledWith(
        "convo-1",
        "assistant",
        expect.stringContaining("The sauna is on the ground floor."),
      );
      expect(updateMessageDeliveryStatusMock).toHaveBeenCalledWith("msg-new-1", "sent");
      expect(markPendingOwnerDecisionResolvedByIdMock).toHaveBeenCalledWith(
        "decision-2",
        "manually_resolved",
      );
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    it("returns 400 when no answer has been captured yet", async () => {
      getPendingOwnerDecisionByIdMock.mockResolvedValueOnce({ ...missingInfoRow, context: null });

      const res = await POST(makeRequest(), makeParams("decision-2"));

      expect(res.status).toBe(400);
      expect(sendWhatsAppMessageMock).not.toHaveBeenCalled();
    });
  });

  it("skips recordMessage when conversationId is null (cascade-cleared) but still resolves", async () => {
    getPendingOwnerDecisionByIdMock.mockResolvedValueOnce({ ...bookingRow, conversationId: null });

    const res = await POST(makeRequest(), makeParams("decision-1"));

    expect(res.status).toBe(200);
    expect(recordMessageMock).not.toHaveBeenCalled();
    expect(updateMessageDeliveryStatusMock).not.toHaveBeenCalled();
    expect(markPendingOwnerDecisionResolvedByIdMock).toHaveBeenCalledWith(
      "decision-1",
      "manually_resolved",
    );
  });

  it("returns a 500 with the error message when a query fails", async () => {
    getPendingOwnerDecisionByIdMock.mockRejectedValueOnce(new Error("db boom"));

    const res = await POST(makeRequest(), makeParams("decision-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "db boom" });
  });
});
