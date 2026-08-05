import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP-layer concerns (auth, parsing, status mapping) are tested here. The
// actual KB-embed/Inngest-send logic is mocked wholesale — its own behavior
// is covered by tests/agent/tools/missing-info.test.ts. There's no more
// Supabase escalations lookup at this layer — the dynamic segment is the
// correlation id itself, not a DB row id.
const handleMissingInfoReplyReceivedMock = vi.fn();
vi.mock("@/agent/tools/missing-info.js", () => ({
  handleMissingInfoReplyReceived: handleMissingInfoReplyReceivedMock,
}));

const { POST } = await import("@/app/api/owner-nudges/[correlationId]/answer/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/owner-nudges/corr-abc-123/answer", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(correlationId: string) {
  return { params: Promise.resolve({ correlationId }) };
}

describe("POST /api/owner-nudges/[correlationId]/answer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    handleMissingInfoReplyReceivedMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }, "wrong-key"),
      makeParams("corr-abc-123"),
    );
    expect(res.status).toBe(401);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("corr-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing answer in request body" });
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is whitespace-only", async () => {
    const res = await POST(makeRequest({ answer: "   " }), makeParams("corr-abc-123"));
    expect(res.status).toBe(400);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("delegates to handleMissingInfoReplyReceived with the correlation id from the path and returns ok: true", async () => {
    handleMissingInfoReplyReceivedMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("corr-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(handleMissingInfoReplyReceivedMock).toHaveBeenCalledWith({
      correlationId: "corr-abc-123",
      answer: "The AC is above the bed",
    });
  });

  it("returns a 500 with the error message when handleMissingInfoReplyReceived throws", async () => {
    handleMissingInfoReplyReceivedMock.mockRejectedValueOnce(new Error("insert boom"));

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("corr-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
  });
});
