import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guestContactsSyncConfigured, syncGuestContacts } from "@/lib/finance/guest-contacts.js";

describe("guestContactsSyncConfigured", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", () => {
    // Node coerces `= undefined` on process.env to the string "undefined"
    // (truthy!) — must actually delete the key to simulate "unset".
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    expect(guestContactsSyncConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    process.env.GUEST_COMMUNICATION_AGENT_API_URL = "http://localhost:3005";
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    expect(guestContactsSyncConfigured()).toBe(true);
  });
});

describe("syncGuestContacts", () => {
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

  it("no-ops (ok: true) when not configured, without calling fetch", async () => {
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;
    const result = await syncGuestContacts();
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the guest-contacts sync route with the X-API-Key header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: 0, updated: 2, guests: [] }), { status: 200 }),
    );

    const result = await syncGuestContacts();

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/guest-contacts/sync");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-API-Key": "test-key" });
  });

  it("returns ok: false with the error message on an HTTP failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await syncGuestContacts();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await syncGuestContacts();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network error");
  });
});
