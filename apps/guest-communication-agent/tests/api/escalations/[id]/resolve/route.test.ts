import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the module boundary for both Supabase (routed by table name, since
// this route touches both escalations and documents) and the embedding
// call — same "mock the shared factory, not the network" approach as every
// other route test in this app, plus a stub for ai's embed() so no real
// OpenRouter call happens.
const maybeSingleMock = vi.fn();
const eqSelectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqSelectMock }));

const insertMock = vi.fn();

const eqUpdateMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqUpdateMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "escalations") {
    return { select: selectMock, update: updateMock };
  }
  if (table === "documents") {
    return { insert: insertMock };
  }
  throw new Error(`resolve route test: unexpected table "${table}"`);
});

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const embedMock = vi.fn();
vi.mock("ai", () => ({ embed: embedMock }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: (model: string) => model }),
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
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    maybeSingleMock.mockReset();
    eqSelectMock.mockClear();
    selectMock.mockClear();
    insertMock.mockReset();
    eqUpdateMock.mockReset();
    updateMock.mockClear();
    fromMock.mockClear();
    embedMock.mockReset();
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    insertMock.mockResolvedValue({ error: null });
    eqUpdateMock.mockResolvedValue({ error: null });
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
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the escalation isn't a missing_info category", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "unhappy_guest", resolved_at: null },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/missing_info/);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the escalation is already resolved", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "missing_info", resolved_at: "2026-07-25T10:00:00Z" },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: "Escalation already resolved" });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message on a Supabase select error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("embeds the answer, inserts into documents, resolves the escalation, and returns ok: true", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "missing_info", resolved_at: null },
      error: null,
    });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    expect(embedMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: "The AC is above the bed" }),
    );

    expect(fromMock).toHaveBeenCalledWith("documents");
    expect(insertMock).toHaveBeenCalledWith({
      content: "The AC is above the bed",
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      metadata: { source: "owner_escalation_answer", escalation_id: "esc-1" },
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ answer: "The AC is above the bed" }),
    );
    expect(eqUpdateMock).toHaveBeenCalledWith("id", "esc-1");
  });

  it("returns a 500 with the error message when the documents insert fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "missing_info", resolved_at: null },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: { message: "insert boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a 500 with the error message when the escalations update fails", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "esc-1", reason_category: "missing_info", resolved_at: null },
      error: null,
    });
    eqUpdateMock.mockResolvedValueOnce({ error: { message: "update boom" } });

    const res = await POST(makeRequest({ answer: "The AC is above the bed" }), makeParams("esc-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "update boom" });
  });
});
