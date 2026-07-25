import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock fetch, not Supabase" approach as the parts of
// tests/api/guest-contacts/[id]/conversations.test.ts that cover the actual
// proxy behavior — this route has no Supabase lookup of its own (unlike that
// one), it's a straight pass-through keyed by messageId.
const { POST } = await import("@/app/api/messages/[messageId]/feedback/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/messages/msg-1/feedback", {
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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    process.env.GUEST_COMMUNICATION_AGENT_API_URL = "http://localhost:3005";
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "gca-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest({ score: 1 }, "wrong-key"), makeParams("msg-1"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies to GCA's feedback endpoint with the message id, body, and GCA's own API key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/messages/msg-1/feedback");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-API-Key": "gca-key", "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ score: 1 }));
  });

  it("forwards additional body fields (e.g. comment) to GCA unchanged", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await POST(
      makeRequest({ score: 0, comment: "gave wrong AC info" }),
      makeParams("msg-1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ score: 0, comment: "gave wrong AC info" }));
  });

  it("returns GCA's response body and status as-is on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "This message has no recorded trace to attach feedback to" }),
        {
          status: 400,
        },
      ),
    );

    const res = await POST(makeRequest({ score: 0 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "This message has no recorded trace to attach feedback to",
    });
  });

  it("returns 502 when GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured", async () => {
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await POST(makeRequest({ score: 1 }), makeParams("msg-1"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("network error");
  });
});
