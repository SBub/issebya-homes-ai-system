import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPromoCode, markPromoCodeRejected, markPromoCodeSent } from "@/lib/telegram/crm.js";

// Same "throws on failure" client convention test shape as this router's
// other X-API-Key-guarded clients — these calls sit in the
// nudge_approve/nudge_reject request-handling path, not a fire-and-forget
// side effect path.
describe("crm client", () => {
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

  describe("getPromoCode", () => {
    it("throws when not configured, without calling fetch", async () => {
      delete process.env.CRM_API_URL;
      await expect(getPromoCode("promo-1")).rejects.toThrow("CRM_API_URL is not configured");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetches and parses the promo code with the X-API-Key header", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "promo-1",
            code: "SUMMER10",
            status: "issued",
            message_text: "Hi! Just checking in...",
            campaign_id: "campaign-1",
            guest_contact_id: "contact-1",
            guest_phone: "+351920742845",
          }),
          { status: 200 },
        ),
      );

      const promoCode = await getPromoCode("promo-1");

      expect(promoCode.status).toBe("issued");
      expect(promoCode.guest_phone).toBe("+351920742845");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3006/api/promo-codes/promo-1");
      expect(init.headers["X-API-Key"]).toBe("test-key");
    });

    it("throws with the response body on a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
      await expect(getPromoCode("missing")).rejects.toThrow(/failed \(404\)[\s\S]*Not found/);
    });
  });

  describe("markPromoCodeSent", () => {
    it("posts to the mark-sent endpoint", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await markPromoCodeSent("promo-1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3006/api/promo-codes/promo-1/mark-sent");
      expect(init.method).toBe("POST");
      expect(init.headers["X-API-Key"]).toBe("test-key");
    });

    it("throws on a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(new Response("Conflict", { status: 409 }));
      await expect(markPromoCodeSent("promo-1")).rejects.toThrow(/failed \(409\)/);
    });
  });

  describe("markPromoCodeRejected", () => {
    it("posts to the mark-rejected endpoint and returns ok: true on success", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const result = await markPromoCodeRejected("promo-1");

      expect(result).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3006/api/promo-codes/promo-1/mark-rejected");
      expect(init.method).toBe("POST");
    });

    it("returns alreadyHandled: true (not a throw) on a 409", async () => {
      fetchMock.mockResolvedValueOnce(new Response("Conflict", { status: 409 }));

      const result = await markPromoCodeRejected("promo-1");

      expect(result).toEqual({ ok: false, alreadyHandled: true });
    });

    it("returns ok: false with an error message on any other failure, without throwing", async () => {
      fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

      const result = await markPromoCodeRejected("promo-1");

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ alreadyHandled: false });
      expect((result as { error?: string }).error).toContain("500");
    });
  });
});
