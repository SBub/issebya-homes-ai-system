import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEscalationByTelegramMessageId,
  resolveEscalation,
  sendGuestMessage,
} from "@/lib/telegram/gca.js";

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

describe("getEscalationByTelegramMessageId", () => {
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
    await expect(getEscalationByTelegramMessageId(42)).rejects.toThrow(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (not a throw) on a 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));

    const result = await getEscalationByTelegramMessageId(42);

    expect(result).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/escalations/by-telegram-message-id/42");
    expect(init.headers).toEqual({ "X-API-Key": "test-key" });
  });

  it("returns the escalation on a match", async () => {
    const row = {
      id: "esc-1",
      phone_number: "+351920742845",
      reason: "Guest asked about the AC",
      reason_category: "missing_info",
      resolved_at: null,
      answer: null,
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(row), { status: 200 }));

    const result = await getEscalationByTelegramMessageId(42);

    expect(result).toEqual(row);
  });

  it("throws on a real (non-404) failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("server exploded", { status: 500 }));

    await expect(getEscalationByTelegramMessageId(42)).rejects.toThrow(/500/);
  });
});

describe("resolveEscalation", () => {
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
    await expect(resolveEscalation("esc-1", "The AC is above the bed")).rejects.toThrow(
      "GUEST_COMMUNICATION_AGENT_API_URL/GUEST_COMMUNICATION_AGENT_API_KEY are not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the answer and returns ok: true, resumed: true on full success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, resumed: true }), { status: 200 }),
    );

    const result = await resolveEscalation("esc-1", "The AC is above the bed");

    expect(result).toEqual({ ok: true, resumed: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/escalations/esc-1/resolve");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-API-Key": "test-key" });
    expect(JSON.parse(init.body)).toEqual({ answer: "The AC is above the bed" });
  });

  it("surfaces resumed: false on a partial success (embedded but no workflow to wake)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, resumed: false }), { status: 200 }),
    );

    const result = await resolveEscalation("esc-1", "The AC is above the bed");

    expect(result).toEqual({ ok: true, resumed: false });
  });

  it("defaults resumed to false when the success body is missing/unparseable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await resolveEscalation("esc-1", "The AC is above the bed");

    expect(result).toEqual({ ok: true, resumed: false });
  });

  it("returns ok: false, alreadyResolved: true on a 409, without throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 409 }));

    const result = await resolveEscalation("esc-1", "The AC is above the bed");

    expect(result).toEqual({ ok: false, alreadyResolved: true });
  });

  it("returns ok: false, alreadyResolved: false with an error on a real failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    const result = await resolveEscalation("esc-1", "The AC is above the bed");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.alreadyResolved).toBe(false);
      expect(result.error).toContain("500");
    }
  });
});
