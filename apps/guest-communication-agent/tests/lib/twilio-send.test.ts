import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTemplateSidForCampaignKind,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
} from "@/lib/twilio-send.js";

// Mocks fetch directly rather than hitting the real Twilio API.
describe("sendWhatsAppMessage", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when TWILIO_ACCOUNT_SID is missing — a deployment misconfiguration, not an external-API failure", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    await expect(sendWhatsAppMessage("+351920742845", "hi")).rejects.toThrow(/TWILIO_ACCOUNT_SID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when TWILIO_WHATSAPP_FROM is missing", async () => {
    delete process.env.TWILIO_WHATSAPP_FROM;
    await expect(sendWhatsAppMessage("+351920742845", "hi")).rejects.toThrow(
      /TWILIO_WHATSAPP_FROM/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs form-encoded to Twilio's Messages API with Basic Auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    const result = await sendWhatsAppMessage("+351920742845", "Your code is SUMMER10");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("AC_test_sid:test-auth-token").toString("base64")}`,
    );
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const bodyParams = new URLSearchParams(init.body);
    expect(bodyParams.get("From")).toBe("whatsapp:+14155238886");
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
    expect(bodyParams.get("Body")).toBe("Your code is SUMMER10");
  });

  it("adds the whatsapp: prefix when the caller's phone doesn't already have one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    await sendWhatsAppMessage("+351920742845", "hi");

    const bodyParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
  });

  it("does not double-prefix when the caller's phone already has whatsapp:", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    await sendWhatsAppMessage("whatsapp:+351920742845", "hi");

    const bodyParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
  });

  it("returns ok: false with the error message on a non-2xx Twilio response, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Invalid number", { status: 400 }));

    const result = await sendWhatsAppMessage("+351920742845", "hi");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("400");
    expect(result.error).toContain("Invalid number");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await sendWhatsAppMessage("+351920742845", "hi");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network error");
  });
});

// Same "mock fetch, don't hit the real Twilio API" approach as
// sendWhatsAppMessage's own describe block above — sendWhatsAppTemplate
// shares the same auth/error-handling/return-shape contract, just posts
// ContentSid/ContentVariables instead of Body.
describe("sendWhatsAppTemplate", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws when TWILIO_ACCOUNT_SID is missing — a deployment misconfiguration, not an external-API failure", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    await expect(sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" })).rejects.toThrow(
      /TWILIO_ACCOUNT_SID/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when TWILIO_WHATSAPP_FROM is missing", async () => {
    delete process.env.TWILIO_WHATSAPP_FROM;
    await expect(sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" })).rejects.toThrow(
      /TWILIO_WHATSAPP_FROM/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs form-encoded ContentSid/ContentVariables to Twilio's Messages API with Basic Auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    const result = await sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("AC_test_sid:test-auth-token").toString("base64")}`,
    );
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const bodyParams = new URLSearchParams(init.body);
    expect(bodyParams.get("From")).toBe("whatsapp:+14155238886");
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
    expect(bodyParams.get("ContentSid")).toBe("HX123");
    expect(bodyParams.get("ContentVariables")).toBe(JSON.stringify({ "1": "Jane" }));
    expect(bodyParams.has("Body")).toBe(false);
  });

  it("adds the whatsapp: prefix when the caller's phone doesn't already have one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    await sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" });

    const bodyParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
  });

  it("does not double-prefix when the caller's phone already has whatsapp:", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "SM123" }), { status: 201 }),
    );

    await sendWhatsAppTemplate("whatsapp:+351920742845", "HX123", { "1": "Jane" });

    const bodyParams = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(bodyParams.get("To")).toBe("whatsapp:+351920742845");
  });

  it("returns ok: false with the error message on a non-2xx Twilio response, does not throw", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Invalid ContentSid", { status: 400 }));

    const result = await sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("400");
    expect(result.error).toContain("Invalid ContentSid");
  });

  it("returns ok: false when fetch itself rejects, does not throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));

    const result = await sendWhatsAppTemplate("+351920742845", "HX123", { "1": "Jane" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network error");
  });
});

describe("getTemplateSidForCampaignKind", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error for a campaign kind with no configured env var at all", () => {
    expect(() => getTemplateSidForCampaignKind("some_future_campaign")).toThrow(
      /No approved WhatsApp template is configured for campaign kind "some_future_campaign"/,
    );
  });

  it("throws a clear error when the mapped env var exists but isn't set yet", () => {
    delete process.env.TEMPLATE_SID_RETURNING_GUEST_DISCOUNT;
    expect(() => getTemplateSidForCampaignKind("returning_guest_discount")).toThrow(
      /TEMPLATE_SID_RETURNING_GUEST_DISCOUNT is not set/,
    );
  });

  it("returns the configured SID once its env var is set", () => {
    process.env.TEMPLATE_SID_WINTER_LOCKIN_PROGRAM = "HX_winter_123";
    expect(getTemplateSidForCampaignKind("winter_lockin_program")).toBe("HX_winter_123");
  });
});
