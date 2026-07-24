import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// list.test.ts/[id].test.ts — this route issues a single terminal
// .from("campaigns").insert(...).select("*").single() call.
const singleMock = vi.fn();
const insertSelectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn((_row: Record<string, unknown>) => ({ select: insertSelectMock }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { POST } = await import("@/app/api/campaigns/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/campaigns", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaigns", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    singleMock.mockReset();
    insertSelectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ name: "Test", kind: "test_kind", message_template: "Hi!" }, "wrong-key"),
    );
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeRequest({ kind: "test_kind", message_template: "Hi!" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "name is required" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is an empty string", async () => {
    const res = await POST(
      makeRequest({ name: "   ", kind: "test_kind", message_template: "Hi!" }),
    );
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when kind is missing", async () => {
    const res = await POST(makeRequest({ name: "Test", message_template: "Hi!" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "kind is required" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message_template is missing", async () => {
    const res = await POST(makeRequest({ name: "Test", kind: "test_kind" }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "message_template is required" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when an optional numeric field is malformed", async () => {
    const res = await POST(
      makeRequest({
        name: "Test",
        kind: "test_kind",
        message_template: "Hi!",
        min_idle_days: "three",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "min_idle_days must be a number" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when is_recurring is malformed", async () => {
    const res = await POST(
      makeRequest({
        name: "Test",
        kind: "test_kind",
        message_template: "Hi!",
        is_recurring: "yes",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "is_recurring must be a boolean" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("creates a campaign with every optional field populated", async () => {
    const created = {
      id: "campaign-new",
      name: "Win-back Fall 2026",
      kind: "returning_guest_discount",
      target_funnel_stage: "booked",
      min_idle_days: 10,
      target_stay_before: "2026-09-01",
      min_total_stays: 1,
      discount_percent: 15,
      offer_description: "15% off",
      message_template: "Hi {{guest_name}}!",
      is_recurring: true,
      enabled: true,
      created_at: "2026-07-24T00:00:00Z",
    };
    singleMock.mockResolvedValueOnce({ data: created, error: null });

    const res = await POST(
      makeRequest({
        name: "Win-back Fall 2026",
        kind: "returning_guest_discount",
        message_template: "Hi {{guest_name}}!",
        target_funnel_stage: "booked",
        min_idle_days: 10,
        target_stay_before: "2026-09-01",
        min_total_stays: 1,
        discount_percent: 15,
        offer_description: "15% off",
        is_recurring: true,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(created);
    expect(fromMock).toHaveBeenCalledWith("campaigns");
    expect(insertMock).toHaveBeenCalledWith({
      name: "Win-back Fall 2026",
      kind: "returning_guest_discount",
      message_template: "Hi {{guest_name}}!",
      target_funnel_stage: "booked",
      min_idle_days: 10,
      target_stay_before: "2026-09-01",
      min_total_stays: 1,
      discount_percent: 15,
      offer_description: "15% off",
      is_recurring: true,
    });
    // enabled is never accepted/forwarded — the column default always
    // applies, even though the caller didn't touch it here.
    expect(insertMock.mock.calls[0][0]).not.toHaveProperty("enabled");
  });

  it("creates a campaign with only the three required fields, applying defaults", async () => {
    const created = {
      id: "campaign-minimal",
      name: "Minimal campaign",
      kind: "manual",
      target_funnel_stage: null,
      min_idle_days: null,
      target_stay_before: null,
      min_total_stays: null,
      discount_percent: null,
      offer_description: "",
      message_template: "Hi!",
      is_recurring: false,
      enabled: true,
      created_at: "2026-07-24T00:00:00Z",
    };
    singleMock.mockResolvedValueOnce({ data: created, error: null });

    const res = await POST(
      makeRequest({ name: "Minimal campaign", kind: "manual", message_template: "Hi!" }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual(created);
    expect(insertMock).toHaveBeenCalledWith({
      name: "Minimal campaign",
      kind: "manual",
      message_template: "Hi!",
    });
  });

  it("returns a 500 with the raw message on a DB error", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });

    const res = await POST(
      makeRequest({ name: "Test", kind: "test_kind", message_template: "Hi!" }),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "connection reset" });
  });
});
