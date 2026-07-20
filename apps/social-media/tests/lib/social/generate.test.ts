import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/lib/social/generate.js";

// Only the pure prompt-building is unit-tested here — the actual LLM call
// (generateSocialPost) isn't, same convention as apps/orch-a not testing
// reporter-agent.ts's .generate() call directly.
describe("buildPrompt", () => {
  it("includes the given idea verbatim", () => {
    const prompt = buildPrompt("Rooftop pool at sunset");
    expect(prompt).toContain("Rooftop pool at sunset");
  });

  it("embeds the seed vocabulary context alongside the idea", () => {
    const prompt = buildPrompt("Rooftop pool at sunset");
    expect(prompt).toContain("Almoçageme");
    expect(prompt).toContain("issebya.homes");
  });
});
