import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";

const sendGuestMessageMock = vi.fn();
const answerOwnerNudgeMock = vi.fn();
const answerBookingLinkApprovalMock = vi.fn();
vi.mock("@/lib/telegram/gca.js", () => ({
  sendGuestMessage: sendGuestMessageMock,
  answerOwnerNudge: answerOwnerNudgeMock,
  answerBookingLinkApproval: answerBookingLinkApprovalMock,
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

describe("POST /api/telegram/webhook — booking_approve/booking_reject callbacks", () => {
  beforeEach(() => {
    answerBookingLinkApprovalMock.mockReset();
    answerCallbackQueryMock.mockReset();
    editMessageTextMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const bookingNudgeMessage = {
    message_id: 77,
    text: "🔗 Booking link\nAna wants to book room1 from 2026-09-01 to 2026-09-05.\n\nApprove sending the booking link to the guest?",
  };

  describe("booking_approve:<correlationId>", () => {
    it("relays approved: true, acks, and edits the message to show Approved", async () => {
      answerBookingLinkApprovalMock.mockResolvedValueOnce({ ok: true });

      const res = await POST(
        makeCallbackRequest("booking_approve:corr-abc-123", bookingNudgeMessage),
      );

      expect(res.status).toBe(200);
      expect(answerBookingLinkApprovalMock).toHaveBeenCalledWith("corr-abc-123", true);
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "✅ Approved");
      expect(editMessageTextMock).toHaveBeenCalledWith(77, expect.stringContaining("✅ Approved"));
    });

    it("shows an error toast, without editing the message, when the relay call fails", async () => {
      answerBookingLinkApprovalMock.mockResolvedValueOnce({ ok: false, error: "GCA down" });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeCallbackRequest("booking_approve:corr-abc-123", bookingNudgeMessage));

      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Failed — try again");
      expect(editMessageTextMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("shows an error toast when answerBookingLinkApproval itself throws", async () => {
      answerBookingLinkApprovalMock.mockRejectedValueOnce(new Error("GCA unreachable"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeCallbackRequest("booking_approve:corr-abc-123", bookingNudgeMessage));

      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "Failed — try again");
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("booking_reject:<correlationId>", () => {
    it("relays approved: false, acks, and edits the message to show Rejected", async () => {
      answerBookingLinkApprovalMock.mockResolvedValueOnce({ ok: true });

      const res = await POST(
        makeCallbackRequest("booking_reject:corr-abc-123", bookingNudgeMessage),
      );

      expect(res.status).toBe(200);
      expect(answerBookingLinkApprovalMock).toHaveBeenCalledWith("corr-abc-123", false);
      expect(answerCallbackQueryMock).toHaveBeenCalledWith("cbq-1", "❌ Rejected");
      expect(editMessageTextMock).toHaveBeenCalledWith(77, expect.stringContaining("❌ Rejected"));
    });

    it("does not call answerOwnerNudge/sendGuestMessage — booking decisions never touch those paths", async () => {
      answerBookingLinkApprovalMock.mockResolvedValueOnce({ ok: true });

      await POST(makeCallbackRequest("booking_reject:corr-abc-123", bookingNudgeMessage));

      expect(answerOwnerNudgeMock).not.toHaveBeenCalled();
      expect(sendGuestMessageMock).not.toHaveBeenCalled();
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
      "x",
    );
  });

  it("does not send to the guest itself — only calls answerOwnerNudge directly, no sendGuestMessage relay", async () => {
    answerOwnerNudgeMock.mockResolvedValueOnce({ ok: true });

    await POST(makeReplyRequest("The AC is above the bed", MISSING_INFO_NUDGE_TEXT));

    expect(sendGuestMessageMock).not.toHaveBeenCalled();
    expect(answerOwnerNudgeMock).toHaveBeenCalledWith(
      "wf-abc-123",
      "The AC is above the bed",
      "Guest asked about the AC",
    );
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
    expect(answerOwnerNudgeMock).toHaveBeenCalledWith(
      "wf-abc-123",
      "The AC is above the bed",
      "Guest asked about the AC",
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "Added to the knowledge base — the agent will reply to the guest shortly",
      ),
    );
  });
});
