import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// register.test.ts/touch.test.ts. This route issues two sequential calls —
// a select().eq().maybeSingle() existence check, then an
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

const { PATCH } = await import("@/app/api/guest-contacts/[id]/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/guest-contacts/contact-1", {
    method: "PATCH",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/guest-contacts/[id]", () => {
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
    const res = await PATCH(
      makeRequest({ phone: "+351920742845" }, "wrong-key"),
      makeParams("contact-1"),
    );
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is missing from the body", async () => {
    const res = await PATCH(makeRequest({}), makeParams("contact-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no guest_contacts row matches the id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await PATCH(makeRequest({ phone: "+351920742845" }), makeParams("missing-id"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("normalizes the phone and updates the row, returning the updated row", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "contact-1" }, error: null });
    singleMock.mockResolvedValueOnce({
      data: { id: "contact-1", phone: "+351920742845" },
      error: null,
    });

    const res = await PATCH(
      makeRequest({ phone: "whatsapp:+351920742845" }),
      makeParams("contact-1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "contact-1", phone: "+351920742845" });
    expect(updateMock).toHaveBeenCalledWith({ phone: "+351920742845" });
    expect(updateEqMock).toHaveBeenCalledWith("id", "contact-1");
  });

  it("returns 409 with a clear message when the phone is already used by another guest", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "contact-1" }, error: null });
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "guest_contacts_phone_key"',
      },
    });

    const res = await PATCH(makeRequest({ phone: "+351920742845" }), makeParams("contact-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "This phone number is already used by another guest" });
  });

  it("returns 500 with the raw message for any other DB error on update", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { id: "contact-1" }, error: null });
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "500", message: "connection reset" },
    });

    const res = await PATCH(makeRequest({ phone: "+351920742845" }), makeParams("contact-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "connection reset" });
  });
});
