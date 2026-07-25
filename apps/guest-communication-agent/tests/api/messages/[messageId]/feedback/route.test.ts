import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the shared Supabase factory, not the network" approach as
// tests/api/send/route.test.ts, plus a mock for langsmith's own Client so
// createFeedback is never a real network call. createFeedback is invoked as
// an instance method off `new Client(...)`, so the mock module exports a
// Client class whose instances all share one createFeedback spy — this
// route only ever constructs one module-level client, but the class shape
// still has to be a real constructable class for `new Client(...)` to work.
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const createFeedbackMock = vi.fn();
vi.mock("langsmith", () => ({
  Client: class {
    createFeedback = createFeedbackMock;
  },
}));

const { POST } = await import("@/app/api/messages/[messageId]/feedback/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/messages/msg-1/feedback", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(messageId: string) {
  return { params: Promise.resolve({ messageId }) };
}

describe("POST /api/messages/[messageId]/feedback", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    process.env.LANGSMITH_API_KEY = "langsmith-test-key";
    maybeSingleMock.mockReset();
    createFeedbackMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest({ score: 1 }, "wrong-key"), makeParams("msg-1"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
    expect(createFeedbackMock).not.toHaveBeenCalled();
  });

  it("returns 400 when score is missing from the body", async () => {
    const res = await POST(makeRequest({}), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeTruthy();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 400 when score is not exactly 0 or 1", async () => {
    const res = await POST(makeRequest({ score: 2 }), makeParams("msg-1"));
    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no message matches messageId", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(makeRequest({ score: 1 }), makeParams("missing-msg"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Message not found" });
    expect(createFeedbackMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the message has no recorded langsmith_run_id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { langsmith_run_id: null }, error: null });

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "This message has no recorded trace to attach feedback to" });
    expect(createFeedbackMock).not.toHaveBeenCalled();
  });

  it("records feedback against the message's own run id and returns ok: true on success", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { langsmith_run_id: "run-abc" }, error: null });
    createFeedbackMock.mockResolvedValueOnce({});

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(createFeedbackMock).toHaveBeenCalledWith("run-abc", "human_approval", { score: 1 });
  });

  it("returns 500 with the underlying error on a LangSmith API failure", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { langsmith_run_id: "run-abc" }, error: null });
    createFeedbackMock.mockRejectedValueOnce(new Error("LangSmith unavailable"));

    const res = await POST(makeRequest({ score: 0 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "LangSmith unavailable" });
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
