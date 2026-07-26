import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route module transitively imports lib/telegram/db.ts (via
// delivery-failures.ts and health-monitor.ts), which throws at import time
// if DATABASE_URL isn't set — must be set before the dynamic import below,
// even though these tests never touch a real DB (pg.Pool itself is lazy).
process.env.DATABASE_URL = "postgresql://test/test";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";

// Mock the module boundary, not the network, for every dependency the new
// nudge_approve/nudge_reject branches touch — the pre-existing done:/
// command branches aren't exercised by these tests, so their own
// dependencies (notifications.js, social.js, digest.js, etc.) are left
// real; none of them do anything at import time that needs mocking.
const getPromoCodeMock = vi.fn();
const markPromoCodeSentMock = vi.fn();
const markPromoCodeRejectedMock = vi.fn();
vi.mock("@/lib/telegram/crm.js", () => ({
  getPromoCode: getPromoCodeMock,
  markPromoCodeSent: markPromoCodeSentMock,
  markPromoCodeRejected: markPromoCodeRejectedMock,
}));

const sendGuestMessageMock = vi.fn();
const getEscalationByTelegramMessageIdMock = vi.fn();
const resolveEscalationMock = vi.fn();
vi.mock("@/lib/telegram/gca.js", () => ({
  sendGuestMessage: sendGuestMessageMock,
  getEscalationByTelegramMessageId: getEscalationByTelegramMessageIdMock,
  resolveEscalation: resolveEscalationMock,
}));

const answerCallbackQueryMock = vi.fn();
const editMessageTextMock = vi.fn();
const sendMessageMock = vi.fn();
const sendWithRetryMock = vi.fn((send: () => Promise<unknown>) => send());
vi.mock("@/lib/telegram/telegram.js", () => ({
  answerCallbackQuery: answerCallbackQueryMock,
  editMessageText: editMessageTextMock,
  sendMessage: sendMessageMock,
  sendWithRetry: sendWithRetryMock,
}));

const { POST } = await import("@/app/api/telegram/webhook/route.js");

function makeCallbackRequest(
  callbackData: string,
  message?: { message_id: number; text?: string },
) {
  return new NextRequest("http://localhost:3003/api/telegram/webhook", {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      update_id: 1,
      callback_query: {
        id: "cbq-1",
        data: callbackData,
        message: message ?? {
          message_id: 42,
          text: "📢 Draft (seasonal_nudge) for +351920742845:\n\nHi!",
        },
      },
    }),
  });
}

function makeReplyRequest(text: string, replyToMessageId?: number) {
  return new NextRequest("http://localhost:3003/api/telegram/webhook", {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      update_id: 2,
      message: {
        message_id: 99,
        chat: { id: 123 },
        text,
        ...(replyToMessageId !== undefined
          ? { reply_to_message: { message_id: replyToMessageId } }
          : {}),
      },
    }),
  });
}

describe("POST /api/telegram/webhook — nudge_approve/nudge_reject callbacks", () => {
  beforeEach(() => {
    getPromoCodeMock.mockReset();
    markPromoCodeSentMock.mockReset();
    markPromoCodeRejectedMock.mockReset();
    sendGuestMessageMock.mockReset();
    getEscalationByTelegramMessageIdMock.mockReset();
    resolveEscalationMock.mockReset();
    answerCallbackQueryMock.mockReset();
    editMessageTextMock.mockReset();
    sendMessageMock.mockReset();
    sendWithRetryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("nudge_approve:<promoCodeId>", () => {
    it("sends the guest message, marks sent, and edits the message on success", async () => {
      getPromoCodeMock.mockResolvedValueOnce({
        id: "promo-1",
        status: "issued",
        message_text: "Hi! Just checking in...",
        guest_phone: "+351920742845",
      });
      sendGuestMessageMock.mockResolvedValueOnce({ ok: true });
      markPromoCodeSentMock.mockResolvedValueOnce(undefined);

      const res = await POST(makeCallbackRequest("nudge_approve:promo-1"));

      expect(res.status).toBe(200);
      expect(sendGuestMessageMock).toHaveBeenCalledWith("+351920742845", "Hi! Just checking in...");
      expect(markPromoCodeSentMock).toHaveBeenCalledWith("promo-1");
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Sent ✅");
      expect(editMessageTextMock).toHaveBeenCalledWith(42, expect.stringContaining("✅ Sent"));
    });

    it("does not send or mark-sent, and shows 'Already handled', when the promo code is no longer issued", async () => {
      getPromoCodeMock.mockResolvedValueOnce({
        id: "promo-1",
        status: "sent",
        message_text: "Hi!",
        guest_phone: "+351920742845",
      });

      await POST(makeCallbackRequest("nudge_approve:promo-1"));

      expect(sendGuestMessageMock).not.toHaveBeenCalled();
      expect(markPromoCodeSentMock).not.toHaveBeenCalled();
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Already handled");
      expect(editMessageTextMock).toHaveBeenCalledWith(
        42,
        expect.stringContaining("Already handled"),
      );
    });

    it("does NOT mark-sent when the GCA send fails, and shows an error toast", async () => {
      getPromoCodeMock.mockResolvedValueOnce({
        id: "promo-1",
        status: "issued",
        message_text: "Hi!",
        guest_phone: "+351920742845",
      });
      sendGuestMessageMock.mockResolvedValueOnce({
        ok: false,
        error: "Twilio rejected the number",
      });

      await POST(makeCallbackRequest("nudge_approve:promo-1"));

      expect(markPromoCodeSentMock).not.toHaveBeenCalled();
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Failed to send — try again");
      expect(editMessageTextMock).not.toHaveBeenCalled();
    });

    it("logs and shows an error toast when getPromoCode itself throws", async () => {
      getPromoCodeMock.mockRejectedValueOnce(new Error("CRM unreachable"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeCallbackRequest("nudge_approve:promo-1"));

      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Failed to send — try again");
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("nudge_reject:<promoCodeId>", () => {
    it("marks rejected and edits the message on success", async () => {
      markPromoCodeRejectedMock.mockResolvedValueOnce({ ok: true });

      await POST(makeCallbackRequest("nudge_reject:promo-1"));

      expect(markPromoCodeRejectedMock).toHaveBeenCalledWith("promo-1");
      expect(sendGuestMessageMock).not.toHaveBeenCalled();
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Rejected");
      expect(editMessageTextMock).toHaveBeenCalledWith(42, expect.stringContaining("❌ Rejected"));
    });

    it("shows 'Already handled' on a 409 without treating it as a failure", async () => {
      markPromoCodeRejectedMock.mockResolvedValueOnce({ ok: false, alreadyHandled: true });

      await POST(makeCallbackRequest("nudge_reject:promo-1"));

      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Already handled");
      expect(editMessageTextMock).toHaveBeenCalledWith(
        42,
        expect.stringContaining("Already handled"),
      );
    });

    it("shows an error toast on a real (non-409) failure", async () => {
      markPromoCodeRejectedMock.mockResolvedValueOnce({
        ok: false,
        alreadyHandled: false,
        error: "CRM down",
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeCallbackRequest("nudge_reject:promo-1"));

      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Failed to reject — try again");
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});

describe("POST /api/telegram/webhook — reply-to-escalation-nudge", () => {
  beforeEach(() => {
    getEscalationByTelegramMessageIdMock.mockReset();
    resolveEscalationMock.mockReset();
    sendGuestMessageMock.mockReset();
    sendMessageMock.mockReset();
    sendWithRetryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls through to the normal dispatch (never looks up an escalation) when the message isn't a reply", async () => {
    const res = await POST(makeReplyRequest("just a normal message"));

    expect(res.status).toBe(200);
    expect(getEscalationByTelegramMessageIdMock).not.toHaveBeenCalled();
  });

  it("falls through to the normal dispatch when the lookup 404s (null)", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce(null);

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(getEscalationByTelegramMessageIdMock).toHaveBeenCalledWith(42);
    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("falls through to the normal dispatch (without an owner toast) when the lookup itself throws", async () => {
    getEscalationByTelegramMessageIdMock.mockRejectedValueOnce(new Error("GCA unreachable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));

    expect(res.status).toBe(200);
    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("tells the owner it's already handled, without sending to the guest, when resolved_at is already set", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: "2026-07-25T10:00:00Z",
      answer: "The AC is above the bed",
    });

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));

    expect(res.status).toBe(200);
    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(resolveEscalationMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(expect.stringContaining("Already handled"));
  });

  it("does not send to the guest itself — only calls resolveEscalation directly, no sendGuestMessage relay", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    });
    resolveEscalationMock.mockResolvedValueOnce({ ok: true, sentToGuest: true });

    await POST(makeReplyRequest("The AC is above the bed", 42));

    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(resolveEscalationMock).toHaveBeenCalledWith("esc-1", "The AC is above the bed");
  });

  it("tells the owner the KB write failed when resolveEscalation itself fails (non-409)", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    });
    resolveEscalationMock.mockResolvedValueOnce({
      ok: false,
      alreadyResolved: false,
      error: "boom",
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add the answer to the knowledge base"),
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("resolves the escalation and confirms full success to the owner when sentToGuest is true", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    });
    resolveEscalationMock.mockResolvedValueOnce({ ok: true, sentToGuest: true });

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(resolveEscalationMock).toHaveBeenCalledWith("esc-1", "The AC is above the bed");
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("Sent to guest and added to the knowledge base"),
    );
  });

  it("reports a partial success — added to the knowledge base but the guest wasn't reached — when sentToGuest is false", async () => {
    getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    });
    resolveEscalationMock.mockResolvedValueOnce({ ok: true, sentToGuest: false });

    const res = await POST(makeReplyRequest("The AC is above the bed", 42));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("Added to the knowledge base, but couldn't reach the guest"),
    );
  });

  // Safety-critical: before performEscalation was unified across all three
  // escalation categories, only missing_info escalations ever got a
  // telegram_message_id, so nothing else could ever reach this branch at
  // all — safety by omission. Now that every category gets one, a reply to
  // a wants_human/complaint nudge must be explicitly refused here rather
  // than relayed to the guest (sendGuestMessage) or sent to GCA's resolve
  // endpoint (resolveEscalation) — which would otherwise relay verbatim to
  // the guest over WhatsApp before resolveEscalation's own
  // reason_category === "missing_info" validation ever gets a chance to
  // reject it.
  for (const reasonCategory of ["wants_human", "complaint"] as const) {
    it(`does NOT relay to the guest or resolve when replying to a ${reasonCategory} escalation nudge`, async () => {
      getEscalationByTelegramMessageIdMock.mockResolvedValueOnce({
        id: "esc-1",
        phone_number: "+351920742845",
        reason: "Guest is upset about noise",
        reason_category: reasonCategory,
        resolved_at: null,
        answer: null,
      });

      const res = await POST(makeReplyRequest("Just give them a discount", 42));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ ok: true });
      expect(sendGuestMessageMock).not.toHaveBeenCalled();
      expect(resolveEscalationMock).not.toHaveBeenCalled();
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("doesn't have an automatic reply/resolve action"),
      );
    });
  }
});
