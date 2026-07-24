import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Combines both this app's existing mocking approaches: Supabase (to look up
// the guest's phone by id — see tests/api/guest-contacts/[id].test.ts) and
// fetch (to proxy to GCA — see the old [phone]/conversations.test.ts this
// file replaces, plus tests/lib/telegram-router-client.test.ts).
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase.js", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

const { GET } = await import("@/app/api/guest-contacts/[id]/conversations/route.js");

function makeRequest(id: string, apiKey = "test-key"): NextRequest {
  return new NextRequest(`http://localhost:3006/api/guest-contacts/${id}/conversations`, {
    method: "GET",
    headers: { "X-API-Key": apiKey },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/guest-contacts/[id]/conversations", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    process.env.GUEST_COMMUNICATION_AGENT_API_URL = "http://localhost:3005";
    process.env.GUEST_COMMUNICATION_AGENT_API_KEY = "gca-key";
    maybeSingleMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await GET(makeRequest("guest-1", "wrong-key"), makeParams("guest-1"));
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no guest_contacts row matches the id", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const res = await GET(makeRequest("missing-guest"), makeParams("missing-guest"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ error: "Not found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns conversations: [] without calling GCA when the guest has no phone yet", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: null }, error: null });

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ conversations: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies to GCA's GET /api/conversations with the guest's phone and GCA's own API key", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    );

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ conversations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3005/api/conversations?phone=%2B351920742845");
    expect(init.headers).toEqual({ "X-API-Key": "gca-key" });
  });

  it("returns GCA's response body and status as-is on a non-2xx response", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });

  it("returns 502 when GUEST_COMMUNICATION_AGENT_API_URL/_API_KEY aren't configured", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });
    delete process.env.GUEST_COMMUNICATION_AGENT_API_URL;

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when fetch itself throws", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { phone: "+351920742845" }, error: null });
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("network error");
  });

  it("returns a 500 with the error message on a Supabase error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const res = await GET(makeRequest("guest-1"), makeParams("guest-1"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ error: "boom" });
  });
});
