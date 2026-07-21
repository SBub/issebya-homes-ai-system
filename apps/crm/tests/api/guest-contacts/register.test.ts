import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared Supabase factory rather than hitting a real database —
// same "mock the module boundary, not the network" approach as
// apps/finance's/apps/guest-communication-agent's crm.ts client tests, just
// one layer further in since this route talks to Supabase directly instead
// of over fetch.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const insertMock = vi.fn(() => Promise.resolve({ error: null }));
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/guest-contacts/register/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/guest-contacts/register", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/guest-contacts/register", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    eqMock.mockClear();
    selectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest({ phone: "+351920742845" }, "wrong-key"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("no-ops (created: false) when a guest_contacts row already exists for the phone", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });

    const res = await POST(makeRequest({ phone: "+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ created: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts a phone-only stub row (created: true) when no row exists yet", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest({ phone: "+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ created: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({ phone: "+351920742845" });
  });

  it("normalizes a Twilio whatsapp: prefix before checking/inserting", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest({ phone: "whatsapp:+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ created: true });
    expect(eqMock).toHaveBeenCalledWith("phone", "+351920742845");
    expect(insertMock).toHaveBeenCalledWith({ phone: "+351920742845" });
  });

  it("treats a whatsapp:-prefixed phone as matching an existing bare-form row", async () => {
    // Same guest, Twilio's prefixed form this time — must land on the same
    // normalized key and see the row that a bare-form request already found.
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });

    const res = await POST(makeRequest({ phone: "whatsapp:+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ created: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is missing from the body", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
