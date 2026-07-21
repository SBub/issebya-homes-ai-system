import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone.js";

describe("normalizePhone", () => {
  it("strips the whatsapp: prefix", () => {
    expect(normalizePhone("whatsapp:+351920742845")).toBe("+351920742845");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePhone("  +351920742845  ")).toBe("+351920742845");
  });

  it("leaves an already-bare number unchanged", () => {
    expect(normalizePhone("+351920742845")).toBe("+351920742845");
  });

  it("strips the prefix regardless of case (defensive — Twilio always lowercases it)", () => {
    expect(normalizePhone("WhatsApp:+351920742845")).toBe("+351920742845");
  });
});
