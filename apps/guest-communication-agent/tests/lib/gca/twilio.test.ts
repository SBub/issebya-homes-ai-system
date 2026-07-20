import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTwilioSignature } from "@/lib/gca/twilio.js";

const AUTH_TOKEN = "test-auth-token";
const URL = "https://example.com/api/webhook/whatsapp";

function sign(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac("sha1", AUTH_TOKEN).update(data, "utf8").digest("base64");
}

describe("verifyTwilioSignature", () => {
  it("accepts a correctly-signed request", () => {
    const params = { From: "whatsapp:+15551234567", Body: "Hello" };
    const signature = sign(URL, params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature)).toBe(true);
  });

  it("is order-independent — params are sorted before signing", () => {
    const params = { Body: "Hello", From: "whatsapp:+15551234567" };
    const signature = sign(URL, { From: "whatsapp:+15551234567", Body: "Hello" });
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong auth token", () => {
    const params: Record<string, string> = { From: "whatsapp:+15551234567" };
    const data = Object.keys(params).reduce((acc, key) => acc + key + params[key], URL);
    const wrongSignature = crypto
      .createHmac("sha1", "wrong-token")
      .update(data, "utf8")
      .digest("base64");
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, wrongSignature)).toBe(false);
  });

  it("rejects a signature computed against a different URL", () => {
    const params = { From: "whatsapp:+15551234567" };
    const signature = sign("https://example.com/different-path", params);
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, signature)).toBe(false);
  });

  it("rejects a signature computed against different params", () => {
    const signature = sign(URL, { From: "whatsapp:+15551234567" });
    expect(
      verifyTwilioSignature(AUTH_TOKEN, URL, { From: "whatsapp:+19999999999" }, signature),
    ).toBe(false);
  });

  it("rejects a malformed/wrong-length signature without throwing", () => {
    const params = { From: "whatsapp:+15551234567" };
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, "not-a-real-signature")).toBe(false);
  });

  it("rejects an empty signature without throwing", () => {
    const params = { From: "whatsapp:+15551234567" };
    expect(verifyTwilioSignature(AUTH_TOKEN, URL, params, "")).toBe(false);
  });
});
