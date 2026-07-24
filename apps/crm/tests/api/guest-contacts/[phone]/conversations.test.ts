import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same fetch-mocking approach as tests/lib/telegram-router-client.test.ts —
// this route proxies to another app over HTTP rather than talking to
// Supabase directly.
const { GET } = await import("@/app/api/guest-contacts/[phone]/conversations/route.js");

function makeRequest(phone: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(`http://localhost:3006/api/guest-contacts/${phone}/conversations`, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(phone: string) {
  return { params: Promise.resolve({ phone }) };
}

describe("GET /api/guest-contacts/[phone]/conversations", () => {
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
    const res = await GET(makeRequest("+351920742845", "wrong-key"), makeParams("+351920742845"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies to GCA's GET /api/conversations with the phone and GCA's own API key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );

    const res = await GET(makeRequest("+351920742845"), makeParams("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ conversations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/conversations?phone=%2B351920742845");
    expect(init.headers).toEqual({ "X-API-Key": "gca-key" });
  });

  it("returns GCA's response body and status as-is on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const res = await GET(makeRequest("+351920742845"), makeParams("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("returns 502 when GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured", async () => {
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;

    const res = await GET(makeRequest("+351920742845"), makeParams("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await GET(makeRequest("+351920742845"), makeParams("+351920742845"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("network error");
  });
});
