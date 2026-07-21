import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// guest-contacts/register.test.ts and touch.test.ts — mock the shared
// Supabase factory rather than hitting a real database. This route issues
// two sequential .from() calls (promo_codes, then guest_contacts), each
// ending in its own .maybeSingle(), so each mock queues its own resolved
// value in call order.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/promo-codes/[id]/route.js");

function makeRequest(id: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(`http://localhost:3006/api/promo-codes/${id}`, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/promo-codes/[id]", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("promo-1", "wrong-key"), makeParams("promo-1"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no promo_codes row matches the id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await GET(makeRequest("missing-id"), makeParams("missing-id"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
  });

  it("returns the promo code with guest_phone looked up via guest_contact_id", async () => {
    maybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "promo-1",
          code: "SUMMER10",
          status: "issued",
          message_text: "Here is your code: SUMMER10",
          campaign_id: "campaign-1",
          guest_contact_id: "contact-1",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });

    const res = await GET(makeRequest("promo-1"), makeParams("promo-1"));
    const json = await res.json();

    expect(json).toEqual({
      id: "promo-1",
      code: "SUMMER10",
      status: "issued",
      message_text: "Here is your code: SUMMER10",
      campaign_id: "campaign-1",
      guest_contact_id: "contact-1",
      guest_phone: "+351920742845",
    });
    expect(fromMock).toHaveBeenCalledWith("promo_codes");
    expect(fromMock).toHaveBeenCalledWith("guest_contacts");
    expect(eqMock).toHaveBeenCalledWith("id", "contact-1");
  });

  it("returns guest_phone: null without a second query when guest_contact_id is null", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "promo-2",
        code: "WORDGIFT",
        status: "issued",
        message_text: "Use code WORDGIFT",
        campaign_id: "campaign-2",
        guest_contact_id: null,
      },
      error: null,
    });

    const res = await GET(makeRequest("promo-2"), makeParams("promo-2"));
    const json = await res.json();

    expect(json).toEqual({
      id: "promo-2",
      code: "WORDGIFT",
      status: "issued",
      message_text: "Use code WORDGIFT",
      campaign_id: "campaign-2",
      guest_contact_id: null,
      guest_phone: null,
    });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalledWith("guest_contacts");
  });
});
