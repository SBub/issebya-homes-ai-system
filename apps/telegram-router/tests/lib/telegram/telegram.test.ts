import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  sendWithRetry,
  telegramConfigured,
} from "@/lib/telegram/telegram.js";

describe("telegramConfigured", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", () => {
    // Node coerces `= undefined` on process.env to the string "undefined"
    // (truthy!) — must actually delete the key to simulate "unset".
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = "chat-id";
    expect(telegramConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "chat-id";
    expect(telegramConfigured()).toBe(true);
  });
});

describe("sendMessage", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat-id";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops (ok: true) when Telegram isn't configured, without calling fetch", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await sendMessage("hello");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts chat_id and text to the sendMessage endpoint", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await sendMessage("hello world");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "test-chat-id", text: "hello world" });
  });

  it("returns ok: false with the error message on an HTTP failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }),
    );

    const result = await sendMessage("hello");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("Unauthorized");
  });

  it("returns ok: false when Telegram reports ok: false even on a 200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }),
    );

    const result = await sendMessage("hello");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("chat not found");
  });

  it("returns the sent message's messageId on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
    );

    const result = await sendMessage("hello");

    expect(result).toEqual({ ok: true, messageId: 42 });
  });

  it("attaches an inline keyboard with a single button when a one-element array is given", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendMessage("Reminder text", [{ text: "✅ Done", callbackData: "done:rfi_21_2027" }]);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).reply_markup).toEqual({
      inline_keyboard: [[{ text: "✅ Done", callback_data: "done:rfi_21_2027" }]],
    });
  });

  it("attaches multiple buttons in a single row when given", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendMessage("Draft message", [
      { text: "✅ Approve", callbackData: "nudge_approve:promo-1" },
      { text: "❌ Reject", callbackData: "nudge_reject:promo-1" },
    ]);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: "nudge_approve:promo-1" },
          { text: "❌ Reject", callback_data: "nudge_reject:promo-1" },
        ],
      ],
    });
  });

  it("does not include parse_mode when not given", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendMessage("hello");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ chat_id: "test-chat-id", text: "hello" });
  });
});

describe("sendWithRetry", () => {
  it("returns the first result without retrying when it succeeds", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const result = await sendWithRetry(send);
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on failure and returns the second result", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "first attempt failed" })
      .mockResolvedValueOnce({ ok: true });
    const result = await sendWithRetry(send);
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns the second result's failure if the retry also fails, without throwing", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: "still failing" });
    const result = await sendWithRetry(send);
    expect(result).toEqual({ ok: false, error: "still failing" });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("answerCallbackQuery", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops when Telegram isn't configured, without calling fetch", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await answerCallbackQuery("cbq-1");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the callback_query_id and optional text", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await answerCallbackQuery("cbq-1", "Marked done ✅");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/answerCallbackQuery");
    expect(JSON.parse(init.body)).toEqual({
      callback_query_id: "cbq-1",
      text: "Marked done ✅",
    });
  });

  it("returns ok: false on failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 400 }));
    const result = await answerCallbackQuery("cbq-1");
    expect(result.ok).toBe(false);
  });
});

describe("editMessageText", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat-id";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops when Telegram isn't configured, without calling fetch", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const result = await editMessageText(42, "updated");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the new text and clears the inline keyboard", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await editMessageText(42, "✅ Marked done");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/editMessageText");
    expect(JSON.parse(init.body)).toEqual({
      chat_id: "test-chat-id",
      message_id: 42,
      text: "✅ Marked done",
      reply_markup: { inline_keyboard: [] },
    });
  });
});
