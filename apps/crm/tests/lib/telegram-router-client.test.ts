import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postCampaignDraft } from "@/lib/telegram-router-client.js";

// Same fire-and-forget resilience contract test shape as
// apps/finance/tests/lib/finance/guest-contacts.test.ts's syncGuestContacts
// suite — this is the same category of call (a best-effort side effect
// after a DB write is already committed).
describe("postCampaignDraft", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TELEGRAM_ROUTER_API_URL = "http://localhost:3003";
    process.env.TELEGRAM_ROUTER_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  const input = {
    promoCodeId: "promo-1",
    campaignKind: "seasonal_nudge",
    guestPhone: "+351920742845",
    messageText: "Hi! Just checking in...",
  };

  it("no-ops (ok: true) when not configured, without calling fetch", async () => {
    delete process.env.TELEGRAM_ROUTER_API_URL;
    const result = await postCampaignDraft(input);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the draft payload with the X-API-Key header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await postCampaignDraft(input);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3003/api/campaign-drafts");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-API-Key": "test-key" });
    expect(JSON.parse(init.body)).toEqual({
      promoCodeId: "promo-1",
      campaignKind: "seasonal_nudge",
      guestPhone: "+351920742845",
      messageText: "Hi! Just checking in...",
    });
  });

  it("returns ok: false with the error message on an HTTP failure, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const result = await postCampaignDraft(input);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await postCampaignDraft(input);

    expect(result).toEqual({ ok: false, error: "network error" });
  });
});
