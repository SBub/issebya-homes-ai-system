import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmConfigured, lookupGuestContact } from "@/lib/crm.js";

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

  // This is the one behavior that's different from every other client-test
  // precedent in this repo (e.g. apps/finance's guest-contacts.test.ts,
  // which returns { ok: false } instead of throwing): loadContext calls
  // this on GCA's real guest-facing request path, so a CRM outage must not
  // break a reply — see crm.ts's own doc comment.
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
