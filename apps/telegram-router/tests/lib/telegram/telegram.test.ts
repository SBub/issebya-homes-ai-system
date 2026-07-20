import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage, telegramConfigured } from "../../../src/lib/telegram/telegram.js";

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
});
