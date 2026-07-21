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
vi.mock("@/lib/telegram/gca.js", () => ({
  sendGuestMessage: sendGuestMessageMock,
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

describe("POST /api/telegram/webhook — nudge_approve/nudge_reject callbacks", () => {
  beforeEach(() => {
    getPromoCodeMock.mockReset();
    markPromoCodeSentMock.mockReset();
    markPromoCodeRejectedMock.mockReset();
    sendGuestMessageMock.mockReset();
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
