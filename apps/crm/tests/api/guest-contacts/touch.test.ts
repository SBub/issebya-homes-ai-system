import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the module boundary, not the network" approach as
// register.test.ts — mock the shared Supabase factory rather than hitting a
// real database.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const updateEqMock = vi.fn(() => Promise.resolve({ error: null }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/guest-contacts/touch/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/guest-contacts/touch", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/guest-contacts/touch", () => {
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
    const res = await POST(makeRequest({ phone: "+351920742845" }, "wrong-key"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when phone is missing from the body", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("no-ops (updated: false) when no guest_contacts row exists for the phone", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest({ phone: "+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ updated: false });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("always sets last_interaction_at when the row is found, even with no stageHint", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "new" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "new" });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ last_interaction_at: expect.any(String) });
    expect(updateEqMock).toHaveBeenCalledWith("id", "contact-1");
  });

  it("upgrades funnel_stage when stageHint outranks the current stage", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "new" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "+351920742845", stageHint: "informed" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "informed" });
    // Exact-match (not objectContaining) deliberately — this also proves
    // link_sent_at is NOT set on a transition to "informed".
    expect(updateMock).toHaveBeenCalledWith({
      last_interaction_at: expect.any(String),
      funnel_stage: "informed",
      stage_updated_at: expect.any(String),
    });
  });

  it("sets link_sent_at specifically when transitioning to link_sent", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "informed" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "+351920742845", stageHint: "link_sent" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "link_sent" });
    expect(updateMock).toHaveBeenCalledWith({
      last_interaction_at: expect.any(String),
      funnel_stage: "link_sent",
      stage_updated_at: expect.any(String),
      link_sent_at: expect.any(String),
    });
  });

  it("does NOT downgrade when stageHint ranks lower than the current stage", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "link_sent" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "+351920742845", stageHint: "informed" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "link_sent" });
    expect(updateMock).toHaveBeenCalledWith({ last_interaction_at: expect.any(String) });
  });

  it("does NOT downgrade when stageHint ranks the same as the current stage", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "link_sent" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "+351920742845", stageHint: "link_sent" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "link_sent" });
    expect(updateMock).toHaveBeenCalledWith({ last_interaction_at: expect.any(String) });
  });

  it("normalizes a Twilio whatsapp: prefix before looking up the row", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "contact-1", funnel_stage: "new" },
      error: null,
    });

    const res = await POST(makeRequest({ phone: "whatsapp:+351920742845" }));
    const json = await res.json();

    expect(json).toEqual({ updated: true, funnel_stage: "new" });
    expect(eqMock).toHaveBeenCalledWith("phone", "+351920742845");
  });
});
