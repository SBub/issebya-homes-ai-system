import { describe, expect, test } from "vitest";
import { isSentryEnabled } from "../sentry-enabled";

describe("isSentryEnabled", () => {
  test("is enabled on the production Vercel deploy", () => {
    expect(isSentryEnabled("production")).toBe(true);
  });

  test.each(["preview", "development", undefined, ""])("is disabled for %j", (vercelEnv) => {
    expect(isSentryEnabled(vercelEnv)).toBe(false);
  });
});
