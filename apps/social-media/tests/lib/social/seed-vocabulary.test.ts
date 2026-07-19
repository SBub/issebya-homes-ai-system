import { describe, expect, it } from "vitest";
import { renderSeedContext } from "../../../src/lib/social/seed-vocabulary.js";

describe("renderSeedContext", () => {
  const context = renderSeedContext();

  it("includes the brand handle and the TikTok self-mention caveat", () => {
    expect(context).toContain("issebya.homes");
    expect(context).toContain("TikTok");
  });

  it("includes the accommodation-intent terms", () => {
    expect(context).toContain("guest house");
    expect(context).toContain("rest space");
    expect(context).toContain("private rooms");
  });

  it("includes the location hierarchy and distance fact", () => {
    expect(context).toContain("Almoçageme");
    expect(context).toContain("Sintra-Cascais Natural Park");
    expect(context).toContain("29 km from Lisbon Airport");
  });

  it("includes the nearby beaches and trails/landmarks", () => {
    expect(context).toContain("Praia da Adraga");
    expect(context).toContain("Cabo da Roca");
  });

  it("includes the room facts and excludes event-space positioning", () => {
    expect(context).toContain("Room 1");
    expect(context).toContain("Room 2");
    expect(context).toContain("max 2 guests per room");
    expect(context).toContain("Do not mention event space");
  });

  it("includes the priority personas", () => {
    expect(context).toContain("solo female travelers");
    expect(context).toContain("recharge and get away from urban life");
  });
});
