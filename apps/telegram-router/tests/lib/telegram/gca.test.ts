import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendGuestMessage } from "@/lib/telegram/gca.js";

describe("sendGuestMessage", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_URL = "http://localhost:3005";
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when not configured, without calling fetch", async () => {
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;
    await expect(sendGuestMessage("+351920742845", "hi")).rejects.toThrow(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts phone/message with the X-API-Key header and returns ok: true on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await sendGuestMessage("+351920742845", "Hi! Just checking in...");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-API-Key": "test-key" });
    expect(JSON.parse(init.body)).toEqual({
      phone: "+351920742845",
      message: "Hi! Just checking in...",
    });
  });

  it("returns ok: false with GCA's own error on a 502 Twilio failure, without throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "invalid number" }), { status: 502 }),
    );

    const result = await sendGuestMessage("+351920742845", "hi");

    expect(result).toEqual({ ok: false, error: "invalid number" });
  });

  it("returns ok: false with a generic message when the failure body has no error field", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));

    const result = await sendGuestMessage("+351920742845", "hi");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("502");
  });
});
