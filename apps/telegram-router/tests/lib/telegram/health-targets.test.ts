import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAllTargets,
  checkTarget,
  HEALTH_TARGETS,
  renderHealthSummary,
} from "@/lib/telegram/health-targets.js";

describe("checkTarget", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TEST_SERVICE_API_URL = "http://localhost:3999";
    process.env.TEST_SERVICE_API_KEY = "test-key";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  // A synthetic target, not one of HEALTH_TARGETS' real entries — isolates
  // checkTarget's own behavior from whatever services are actually wired up.
  const testTarget = {
    service: "test-service",
    urlEnvVar: "TEST_SERVICE_API_URL",
    keyEnvVar: "TEST_SERVICE_API_KEY",
    path: "/api/health",
  };

  it("returns ok: true on a 200 response, with the X-API-Key header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await checkTarget(testTarget);

    expect(result).toEqual({ service: "test-service", ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3999/api/health");
    expect(init.headers["X-API-Key"]).toBe("test-key");
  });

  it("returns ok: false with the status on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));

    const result = await checkTarget(testTarget);

    expect(result).toEqual({
      service: "test-service",
      ok: false,
      error: "/api/health returned 503",
    });
  });

  it("returns ok: false with the error message when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unreachable"));

    const result = await checkTarget(testTarget);

    expect(result).toEqual({
      service: "test-service",
      ok: false,
      error: "network unreachable",
    });
  });

  it("returns ok: false without calling fetch when the URL/key env vars aren't configured", async () => {
    delete process.env.TEST_SERVICE_API_URL;

    const result = await checkTarget(testTarget);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("TEST_SERVICE_API_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkAllTargets", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("checks every configured target and reports unconfigured ones as unhealthy", async () => {
    // Nothing configured — every target should come back ok: false without throwing.
    for (const target of HEALTH_TARGETS) {
      delete process.env[target.urlEnvVar];
      delete process.env[target.keyEnvVar];
    }
    vi.stubGlobal("fetch", vi.fn());

    const results = await checkAllTargets();

    expect(results).toHaveLength(HEALTH_TARGETS.length);
    expect(results.every((r) => r.ok === false)).toBe(true);
    expect(results.map((r) => r.service)).toEqual(HEALTH_TARGETS.map((t) => t.service));
  });
});

describe("renderHealthSummary", () => {
  it("marks a healthy service with a green circle", () => {
    const text = renderHealthSummary([{ service: "test-service", ok: true }]);
    expect(text).toContain("🟢 test-service: ok");
  });

  it("marks an unhealthy service with a red circle and its error", () => {
    const text = renderHealthSummary([
      { service: "finance", ok: false, error: "/api/health returned 503" },
    ]);
    expect(text).toContain("🔴 finance: /api/health returned 503");
  });

  it("lists every service, one line each", () => {
    const text = renderHealthSummary([
      { service: "test-service", ok: true },
      { service: "finance", ok: false, error: "timeout" },
    ]);
    const lines = text.split("\n");
    expect(lines).toContain("🟢 test-service: ok");
    expect(lines).toContain("🔴 finance: timeout");
  });
});
