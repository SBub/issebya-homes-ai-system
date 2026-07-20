import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDigest } from "../../../src/lib/telegram/orch-a.js";

describe("getDigest", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.ORCH_A_API_URL = "http://localhost:4111";
    process.env.ORCH_A_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when ORCH_A_API_URL isn't configured, without calling fetch", async () => {
    delete process.env.ORCH_A_API_URL;
    await expect(getDigest()).rejects.toThrow("ORCH_A_API_URL is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when ORCH_A_API_KEY isn't configured, without calling fetch", async () => {
    delete process.env.ORCH_A_API_KEY;
    await expect(getDigest()).rejects.toThrow("ORCH_A_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the digest with the X-API-Key header and returns the parsed text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "<b>Orch-A Daily Digest</b>" }), { status: 200 }),
    );

    const result = await getDigest();

    expect(result).toEqual({ text: "<b>Orch-A Daily Digest</b>" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4111/digest");
    expect(init.headers["X-API-Key"]).toBe("test-key");
  });

  it("throws with the response body on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(getDigest()).rejects.toThrow(/failed \(500\)[\s\S]*boom/);
  });
});
