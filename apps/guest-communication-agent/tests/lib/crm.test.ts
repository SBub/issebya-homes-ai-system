import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crmConfigured,
  lookupGuestContact,
  registerGuestContact,
  touchGuestContact,
} from "@/lib/crm.js";

describe("crmConfigured", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", () => {
    // Node coerces `= undefined` on process.env to the string "undefined"
    // (truthy!) — must actually delete the key to simulate "unset".
    delete process.env.CRM_API_URL;
    process.env.CRM_API_KEY = "test-key";
    expect(crmConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    process.env.CRM_API_URL = "http://localhost:3006";
    process.env.CRM_API_KEY = "test-key";
    expect(crmConfigured()).toBe(true);
  });
});

describe("lookupGuestContact", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_URL = "http://localhost:3006";
    process.env.CRM_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("returns null (no-op) when not configured, without calling fetch", async () => {
    delete process.env.CRM_API_URL;
    const result = await lookupGuestContact("+351920742845");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs the lookup route with the phone query param and X-API-Key header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          found: true,
          last_room: "room_2",
          last_stay_checkin: "2025-09-28",
          total_stays: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await lookupGuestContact("whatsapp:+351920742845");

    expect(result).toEqual({
      found: true,
      last_room: "room_2",
      last_stay_checkin: "2025-09-28",
      total_stays: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3006/api/guest-contacts/lookup?phone=whatsapp%3A%2B351920742845",
    );
    expect(init.headers).toEqual({ "X-API-Key": "test-key" });
  });

  it("returns null rather than throwing on a non-2xx response, does not crash", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await lookupGuestContact("+351920742845");

    expect(result).toBeNull();
  });

  it("returns null rather than throwing when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await lookupGuestContact("+351920742845");

    expect(result).toBeNull();
  });
});

describe("registerGuestContact", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_URL = "http://localhost:3006";
    process.env.CRM_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops (ok: true) when not configured, without calling fetch", async () => {
    delete process.env.CRM_API_URL;
    const result = await registerGuestContact("+351920742845");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the guest-contacts register route with the phone body and X-API-Key header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ created: true }), { status: 200 }),
    );

    const result = await registerGuestContact("whatsapp:+351920742845");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3006/api/guest-contacts/register");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-API-Key": "test-key", "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ phone: "whatsapp:+351920742845" }));
  });

  it("returns ok: false with the error message on an HTTP failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await registerGuestContact("+351920742845");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await registerGuestContact("+351920742845");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network error");
  });
});

describe("touchGuestContact", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_URL = "http://localhost:3006";
    process.env.CRM_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("no-ops (ok: true) when not configured, without calling fetch", async () => {
    delete process.env.CRM_API_URL;
    const result = await touchGuestContact("+351920742845");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the guest-contacts touch route with the phone body and X-API-Key header, no stageHint", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ updated: true, funnel_stage: "new" }), { status: 200 }),
    );

    const result = await touchGuestContact("whatsapp:+351920742845");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3006/api/guest-contacts/touch");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-API-Key": "test-key", "Content-Type": "application/json" });
    // JSON.stringify drops the stageHint key entirely when it's undefined —
    // the request body has no stageHint field at all in this case, not
    // stageHint: null.
    expect(init.body).toBe(JSON.stringify({ phone: "whatsapp:+351920742845" }));
  });

  it("includes stageHint in the request body when given", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ updated: true, funnel_stage: "link_sent" }), { status: 200 }),
    );

    const result = await touchGuestContact("+351920742845", "link_sent");

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ phone: "+351920742845", stageHint: "link_sent" }));
  });

  it("returns ok: false with the error message on an HTTP failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await touchGuestContact("+351920742845");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await touchGuestContact("+351920742845");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network error");
  });
});
