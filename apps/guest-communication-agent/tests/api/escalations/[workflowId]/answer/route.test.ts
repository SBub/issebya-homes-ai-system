import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP-layer concerns (auth, parsing, status mapping) are tested here. The
// actual KB-embed/DBOS-wake logic is mocked wholesale — its own behavior is
// covered by tests/agent/tools/missing-info.test.ts. There's no more
// Supabase escalations lookup at this layer — the dynamic segment is the
// workflow id itself, not a DB row id.
const handleMissingInfoReplyReceivedMock = vi.fn();
vi.mock("@/agent/tools/missing-info.js", () => ({
  handleMissingInfoReplyReceived: handleMissingInfoReplyReceivedMock,
}));

const ensureDbosLaunchedMock = vi.fn();
vi.mock("@/lib/dbos.js", () => ({
  ensureDbosLaunched: ensureDbosLaunchedMock,
}));

const { POST } = await import("@/app/api/escalations/[workflowId]/answer/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3005/api/escalations/wf-abc-123/answer", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(workflowId: string) {
  return { params: Promise.resolve({ workflowId }) };
}

describe("POST /api/escalations/[workflowId]/answer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "test-key";
    handleMissingInfoReplyReceivedMock.mockReset();
    ensureDbosLaunchedMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }, "wrong-key"),
      makeParams("wf-abc-123"),
    );
    expect(res.status).toBe(401);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is missing", async () => {
    const res = await POST(makeRequest({}), makeParams("wf-abc-123"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "Missing answer in request body" });
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("returns 400 when answer is whitespace-only", async () => {
    const res = await POST(makeRequest({ answer: "   " }), makeParams("wf-abc-123"));
    expect(res.status).toBe(400);
    expect(handleMissingInfoReplyReceivedMock).not.toHaveBeenCalled();
  });

  it("ensures DBOS is launched, then delegates to handleMissingInfoReplyReceived with the workflow id from the path and returns its result", async () => {
    handleMissingInfoReplyReceivedMock.mockResolvedValueOnce({ resumed: true });

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("wf-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, resumed: true });
    expect(ensureDbosLaunchedMock).toHaveBeenCalled();
    expect(handleMissingInfoReplyReceivedMock).toHaveBeenCalledWith({
      workflowId: "wf-abc-123",
      answer: "The AC is above the bed",
    });
  });

  it("returns resumed: false when handleMissingInfoReplyReceived reports no such workflow (duplicate/late reply)", async () => {
    handleMissingInfoReplyReceivedMock.mockResolvedValueOnce({ resumed: false });

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("wf-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, resumed: false });
  });

  it("returns a 500 with the error message when handleMissingInfoReplyReceived throws", async () => {
    handleMissingInfoReplyReceivedMock.mockRejectedValueOnce(new Error("insert boom"));

    const res = await POST(
      makeRequest({ answer: "The AC is above the bed" }),
      makeParams("wf-abc-123"),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "insert boom" });
  });
});
