import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route is now a thin trigger: HTTP-layer concerns (auth, request-body
// parsing, the escalation lookup and its 404/400/409 status mapping) stay
// here and are tested against a real (mocked-at-the-DB-boundary) Supabase
// client, but the actual "a missing_info reply arrived" business logic
// (embed, resolve, wake the suspended DBOS workflow) now lives in
// @/agent/tools/missing-info.ts's handleMissingInfoReplyReceived, which is
// mocked wholesale here — its own real behavior (including its DBOS.send
// wiring) is covered by tests/agent/tools/missing-info.test.ts, not this
// file. @/lib/dbos.ts's ensureDbosLaunched is also mocked at the module
// boundary so this suite never touches a real DBOS/Postgres connection.
const maybeSingleMock = vi.fn();
const eqSelectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqSelectMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "escalations") {
    return { select: selectMock };
  }
  throw new Error(`resolve route test: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const handleMissingInfoReplyReceivedMock = vi.fn();
vi.mock("@/agent/tools/missing-info.js", () => ({
  handleMissingInfoReplyReceived: handleMissingInfoReplyReceivedMock,
}));

const ensureDbosLaunchedMock = vi.fn();
vi.mock("@/lib/dbos.js", () => ({
  ensureDbosLaunched: ensureDbosLaunchedMock,
}));

const { POST } = await import("@/app/api/escalations/[id]/resolve/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/escalations/esc-1/resolve", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/escalations/[id]/resolve", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    maybeSingleMock.mockReset();
    eqSelectMock.mockClear();
    selectMock.mockClear();
    fromMock.mockClear();
    handleMissingInfoReplyReceivedMock.mockReset();
    ensureDbosLaunchedMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }, "wrong-key"),
      makeParams("esc-1"),
    );
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing answer in request body" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is whitespace-only", async () => {
    const res = await POST(makeRequest({ answer: "   " }), makeParams("esc-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no such escalation exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("missing"),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Escalation not found" });
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the escalation isn't a missing_info category", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "wants_human", resolved_at: null, workflow_id: null },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing_info/);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the escalation is already resolved", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: "2026-07-25T10:00:00Z",
        workflow_id: null,
      },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "Escalation already resolved" });
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message on a Supabase select error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("ensures DBOS is launched, then delegates to handleMissingInfoReplyReceived with the escalation's workflow_id and returns its result", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        workflow_id: "wf-abc-123",
      },
      error: null,
    });
    handleMissingInfoReplyReceivedMock.mockResolvedValueOnce({ resumed: true });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, resumed: true });
    expect(ensureDbosLaunchedMock).toHaveBeenCalled();
    expect(handleMissingInfoReplyReceivedMock).toHaveBeenCalledWith({
      escalationId: "esc-1",
      answer: "The AC is above the bed",
      workflowId: "wf-abc-123",
    });
  });

  it("passes workflowId: null through untouched when the escalation has none", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        workflow_id: null,
      },
      error: null,
    });
    handleMissingInfoReplyReceivedMock.mockResolvedValueOnce({ resumed: false });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, resumed: false });
    expect(handleMissingInfoReplyReceivedMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: null }),
    );
  });

  it("returns a 500 with the error message when handleMissingInfoReplyReceived throws", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "esc-1",
        reason_category: "missing_info",
        resolved_at: null,
        workflow_id: null,
      },
      error: null,
    });
    handleMissingInfoReplyReceivedMock.mockRejectedValueOnce(new Error("insert boom"));

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
  });
});
