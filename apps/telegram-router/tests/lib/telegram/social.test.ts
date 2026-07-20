import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSocialPost } from "../../../src/lib/telegram/social.js";

describe("generateSocialPost", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.SOCIAL_MEDIA_API_URL = "http://localhost:3002";
    process.env.SOCIAL_MEDIA_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when SOCIAL_MEDIA_API_URL/KEY aren't configured, without calling fetch", async () => {
    delete process.env.SOCIAL_MEDIA_API_URL;
    await expect(generateSocialPost("idea")).rejects.toThrow(
      "SOCIAL_MEDIA_API_URL/SOCIAL_MEDIA_API_KEY are not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the idea with the X-API-Key header and returns the parsed result", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ altText: "alt", caption: "caption", notionOk: true }), {
        status: 200,
      }),
    );

    const result = await generateSocialPost("Rooftop pool at sunset");

    expect(result).toEqual({ altText: "alt", caption: "caption", notionOk: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3002/api/generate");
    expect(init.headers["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({ idea: "Rooftop pool at sunset" });
  });

  it("throws with the response body on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(generateSocialPost("idea")).rejects.toThrow(/failed \(500\)[\s\S]*boom/);
  });
});
