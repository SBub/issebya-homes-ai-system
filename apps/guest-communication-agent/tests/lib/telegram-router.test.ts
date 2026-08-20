import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOwnerNudge } from "@/lib/telegram-router.js";

// Mocks fetch directly rather than hitting the real telegram-router API.
describe("sendOwnerNudge", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TELEGRAM_ROUTER_API_URL = "http://localhost:3003";
    process.env.TELEGRAM_ROUTER_API_KEY = "test-api-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  const params = {
    phone: "+351920742845",
    reason: "Guest is asking about the AC",
    reasonCategory: "missing_info" as const,
    conversationId: "convo-1",
  };

  it("returns ok: false (not true) and logs when TELEGRAM_ROUTER_API_URL is missing — does not call fetch", async () => {
    delete process.env.TELEGRAM_ROUTER_API_URL;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendOwnerNudge(params);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("TELEGRAM_ROUTER_API_URL");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("returns ok: false and logs when TELEGRAM_ROUTER_API_KEY is missing — does not call fetch", async () => {
    delete process.env.TELEGRAM_ROUTER_API_KEY;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendOwnerNudge(params);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("TELEGRAM_ROUTER_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("posts to telegram-router and returns ok: true on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await sendOwnerNudge(params);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3003/api/owner-nudges");
    expect(init.headers["X-API-Key"]).toBe("test-api-key");
  });

  it("returns ok: false with the error message on a non-2xx response, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );

    const result = await sendOwnerNudge(params);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("bad request");
  });
});
