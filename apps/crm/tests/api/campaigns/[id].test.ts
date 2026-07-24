import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// guest-contacts/[id].test.ts. This route issues two sequential calls — a
// select().eq().maybeSingle() existence check, then an
// update().eq().select().single() that both writes and returns the updated
// row in one round trip — so each half of the chain gets its own mock.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));

const singleMock = vi.fn();
const updateSelectMock = vi.fn(() => ({ single: singleMock }));
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { PATCH } = await import("@/app/api/campaigns/[id]/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/campaigns/campaign-1", {
    method: "PATCH",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/campaigns/[id]", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    singleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    updateSelectMock.mockClear();
    updateEqMock.mockClear();
    updateMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await PATCH(makeRequest({ enabled: false }, "wrong-key"), makeParams("campaign-1"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when enabled is missing from the body", async () => {
    const res = await PATCH(makeRequest({}), makeParams("campaign-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when enabled is not a boolean", async () => {
    const res = await PATCH(makeRequest({ enabled: "true" }), makeParams("campaign-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no campaigns row matches the id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await PATCH(makeRequest({ enabled: false }), makeParams("missing-id"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the enabled column and returns the updated row", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "campaign-1" }, error: null });
    singleMock.mockResolvedValueOnce({
      data: { id: "campaign-1", enabled: false },
      error: null,
    });

    const res = await PATCH(makeRequest({ enabled: false }), makeParams("campaign-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "campaign-1", enabled: false });
    expect(updateMock).toHaveBeenCalledWith({ enabled: false });
    expect(updateEqMock).toHaveBeenCalledWith("id", "campaign-1");
  });

  it("returns 500 with the raw message for any other DB error on update", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "campaign-1" }, error: null });
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "500", message: "connection reset" },
    });

    const res = await PATCH(makeRequest({ enabled: true }), makeParams("campaign-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "connection reset" });
  });

  it("returns 500 with the raw message when the existence check errors", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });

    const res = await PATCH(makeRequest({ enabled: true }), makeParams("campaign-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "connection reset" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
