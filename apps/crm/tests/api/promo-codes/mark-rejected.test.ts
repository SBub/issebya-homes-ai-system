import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// guest-contacts/touch.test.ts and mark-sent.test.ts.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const updateEqMock = vi.fn(() => Promise.resolve({ error: null }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/promo-codes/[id]/mark-rejected/route.js");

function makeRequest(id: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(`http://localhost:3006/api/promo-codes/${id}/mark-rejected`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/promo-codes/[id]/mark-rejected", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    updateEqMock.mockClear();
    updateMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest("promo-1", "wrong-key"), makeParams("promo-1"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no promo_codes row matches the id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest("missing-id"), makeParams("missing-id"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("marks an 'issued' row as rejected", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "promo-1", status: "issued" },
      error: null,
    });

    const res = await POST(makeRequest("promo-1"), makeParams("promo-1"));
    const json = await res.json();

    expect(json).toEqual({ ok: true, status: "rejected" });
    expect(updateMock).toHaveBeenCalledWith({ status: "rejected" });
    expect(updateEqMock).toHaveBeenCalledWith("id", "promo-1");
  });

  it.each(["sent", "rejected", "expired"])(
    "returns 409 without updating when status is already '%s'",
    async (currentStatus) => {
      maybeSingleMock.mockResolvedValueOnce({
        data: { id: "promo-1", status: currentStatus },
        error: null,
      });

      const res = await POST(makeRequest("promo-1"), makeParams("promo-1"));
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toEqual({ error: `Cannot mark rejected from status '${currentStatus}'` });
      expect(updateMock).not.toHaveBeenCalled();
    },
  );
});
