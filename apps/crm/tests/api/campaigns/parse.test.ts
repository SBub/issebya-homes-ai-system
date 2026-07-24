import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route talks directly to OpenRouter via fetch (no DB, no LangChain) —
// same "mock the module boundary" shape as
// tests/lib/telegram-router-client.test.ts and
// tests/api/guest-contacts/[id]/conversations.test.ts's own fetch-mocking
// half: stub global fetch, never hit the real network.
const { POST } = await import("@/app/api/campaigns/parse/route.js");

function makeRequest(body: unknown, apiKey = "test-key"): NextRequest {
  return new NextRequest("http://localhost:3006/api/campaigns/parse", {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function openRouterResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status },
  );
}

describe("POST /api/campaigns/parse", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.CRM_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "or-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("rejects requests without a valid X-API-Key", async () => {
    const res = await POST(makeRequest({ description: "Win back past guests" }, "wrong-key"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when description is missing", async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "description is required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when description is an empty string", async () => {
    const res = await POST(makeRequest({ description: "   " }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toEqual({ error: "description is required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when OPENROUTER_API_KEY isn't configured", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const res = await POST(makeRequest({ description: "Win back past guests" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({ error: "OpenRouter is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls OpenRouter's chat completions endpoint and returns a validated draft on success", async () => {
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        name: "Win-back: 10% off for past guests",
        kind: "returning_guest_discount",
        target_stay_before: "2026-06-01",
        discount_percent: 10,
        message_template:
          "Hi {{guest_name}}! Come back and enjoy {{discount_percent}}% off with code {{promo_code}}.",
        is_recurring: false,
      }),
    );

    const res = await POST(
      makeRequest({
        description: "Invite past guests who stayed before June, offer them 10% off to come back",
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      name: "Win-back: 10% off for past guests",
      kind: "returning_guest_discount",
      target_stay_before: "2026-06-01",
      discount_percent: 10,
      message_template:
        "Hi {{guest_name}}! Come back and enjoy {{discount_percent}}% off with code {{promo_code}}.",
      is_recurring: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer or-key",
      "Content-Type": "application/json",
    });
    const sentBody = JSON.parse(init.body);
    expect(sentBody.model).toBe("deepseek/deepseek-v4-pro");
    expect(sentBody.response_format).toEqual({ type: "json_object" });
    expect(sentBody.messages).toHaveLength(2);
    expect(sentBody.messages[0].role).toBe("system");
    expect(sentBody.messages[1]).toEqual({
      role: "user",
      content: "Invite past guests who stayed before June, offer them 10% off to come back",
    });
  });

  it("drops a wrong-typed optional field rather than failing the whole request", async () => {
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        name: "Idle nudge",
        kind: "stalled_nudge",
        message_template: "Hi {{guest_name}}, still there?",
        min_idle_days: "fourteen", // wrong type — should be dropped, not error
      }),
    );

    const res = await POST(makeRequest({ description: "Nudge guests who have gone quiet" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      name: "Idle nudge",
      kind: "stalled_nudge",
      message_template: "Hi {{guest_name}}, still there?",
    });
  });

  it("returns 502 when the model's output is missing a required field", async () => {
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        name: "Idle nudge",
        message_template: "Hi {{guest_name}}, still there?",
        // kind missing
      }),
    );

    const res = await POST(makeRequest({ description: "Nudge guests who have gone quiet" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({
      error: "Could not generate a usable campaign from that description — try adding more detail.",
    });
  });

  it("returns 502 when message_template is an empty string", async () => {
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        name: "Idle nudge",
        kind: "stalled_nudge",
        message_template: "   ",
      }),
    );

    const res = await POST(makeRequest({ description: "Nudge guests who have gone quiet" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("Could not generate a usable campaign");
  });

  it("returns 502 when the OpenRouter call itself fails (non-2xx)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    const res = await POST(makeRequest({ description: "Win back past guests" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("401");
  });

  it("returns 502 when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const res = await POST(makeRequest({ description: "Win back past guests" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("network error");
  });

  it("returns 502 when the model's content isn't valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
        status: 200,
      }),
    );

    const res = await POST(makeRequest({ description: "Win back past guests" }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("non-JSON");
  });
});
