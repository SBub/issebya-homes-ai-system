import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";

const getPromoCodeMock = vi.fn();
const markPromoCodeSentMock = vi.fn();
const markPromoCodeRejectedMock = vi.fn();
vi.mock("@/lib/telegram/crm.js", () => ({
  getPromoCode: getPromoCodeMock,
  markPromoCodeSent: markPromoCodeSentMock,
  markPromoCodeRejected: markPromoCodeRejectedMock,
}));

const sendGuestMessageMock = vi.fn();
const answerOwnerNudgeMock = vi.fn();
vi.mock("@/lib/telegram/gca.js", () => ({
  sendGuestMessage: sendGuestMessageMock,
  answerOwnerNudge: answerOwnerNudgeMock,
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

function makeReplyRequest(text: string, repliedToText?: string) {
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
        ...(repliedToText !== undefined
          ? { reply_to_message: { message_id: 42, text: repliedToText } }
          : {}),
      },
    }),
  });
}

const MISSING_INFO_NUDGE_TEXT =
  '🔍 Missing info\nGuest +351920742845 asked: "Guest asked about the AC"\n\nReply to this message with the answer — I\'ll send it to the guest and add it to the knowledge base.\n\n[ref:wf-abc-123]';

describe("POST /api/telegram/webhook — nudge_approve/nudge_reject callbacks", () => {
  beforeEach(() => {
    getPromoCodeMock.mockReset();
    markPromoCodeSentMock.mockReset();
    markPromoCodeRejectedMock.mockReset();
    sendGuestMessageMock.mockReset();
    answerOwnerNudgeMock.mockReset();
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

describe("POST /api/telegram/webhook — reply-to-owner-nudge", () => {
  beforeEach(() => {
    answerOwnerNudgeMock.mockReset();
    sendGuestMessageMock.mockReset();
    sendMessageMock.mockReset();
    sendWithRetryMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("falls through to the normal dispatch (never calls answerOwnerNudge) when the message isn't a reply", async () => {
    const res = await POST(makeReplyRequest("just a normal message"));

    expect(res.status).toBe(200);
    expect(answerOwnerNudgeMock).not.toHaveBeenCalled();
  });

  it("falls through to the normal dispatch when the replied-to text has no [ref:...] tag (an unrelated reply)", async () => {
    const res = await POST(makeReplyRequest("just a normal reply", "some earlier chat message"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(answerOwnerNudgeMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("falls through to the normal dispatch when replying to a wants_human nudge (one-way, never carries a ref tag)", async () => {
    const res = await POST(
      makeReplyRequest(
        "Just give them a discount",
        "🙋 Wants human\nGuest +351920742845 needs you: Guest is upset about noise\n\nConversation: convo-1",
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(answerOwnerNudgeMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("extracts an opaque (non-UUID) ref token just as readily as a UUID-shaped one", async () => {
    answerOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    await POST(
      makeReplyRequest(
        "The AC is above the bed",
        '🔍 Missing info\nGuest +351920742845 asked: "x"\n\nReply to this message with the answer — I\'ll send it to the guest and add it to the knowledge base.\n\n[ref:sha-2f9a-not-a-uuid]',
      ),
    );

    expect(answerOwnerNudgeMock).toHaveBeenCalledWith(
      "sha-2f9a-not-a-uuid",
      "The AC is above the bed",
    );
  });

  it("does not send to the guest itself — only calls answerOwnerNudge directly, no sendGuestMessage relay", async () => {
    answerOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    await POST(makeReplyRequest("The AC is above the bed", MISSING_INFO_NUDGE_TEXT));

    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(answerOwnerNudgeMock).toHaveBeenCalledWith("wf-abc-123", "The AC is above the bed");
  });

  it("tells the owner the KB write failed when answerOwnerNudge itself fails", async () => {
    answerOwnerNudgeMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeReplyRequest("The AC is above the bed", MISSING_INFO_NUDGE_TEXT));

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add the answer to the knowledge base"),
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("confirms success to the owner on ok: true — GCA (Inngest-backed now) has no 'resumed' signal to distinguish a partial success with", async () => {
    answerOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    const res = await POST(makeReplyRequest("The AC is above the bed", MISSING_INFO_NUDGE_TEXT));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(answerOwnerNudgeMock).toHaveBeenCalledWith("wf-abc-123", "The AC is above the bed");
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "Added to the knowledge base — the agent will reply to the guest shortly",
      ),
    );
  });
});
