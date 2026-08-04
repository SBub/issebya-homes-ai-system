import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppMessage } from "@/lib/twilio-send.js";

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
