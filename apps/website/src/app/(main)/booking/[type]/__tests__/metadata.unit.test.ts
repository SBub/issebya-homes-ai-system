import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/site";
import { generateMetadata } from "../page";

// --- Mocks ---

// BookingEngine's import graph does not load in the node pool, and
// generateMetadata never touches it.
vi.mock("../ui/BookingEngine", () => ({ BookingEngine: () => null }));

// --- Helpers ---

const meta = (type: string) => generateMetadata({ params: Promise.resolve({ type }) });

type OgImage = { url: string; width?: number; height?: number; type?: string; alt?: string };

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const ogImages = (m: Metadata) => toArray(m.openGraph?.images) as OgImage[];
const twitterImages = (m: Metadata) =>
  toArray(m.twitter?.images).map((image) =>
    typeof image === "string" ? image : String((image as { url: string | URL }).url),
  );

// --- Tests ---

describe.each([
  { type: "room1", roomTitle: "Private room 1" },
  { type: "room2", roomTitle: "Private room 2" },
])("generateMetadata for $type", ({ type, roomTitle }) => {
  it("points og:url and the canonical at the room page", async () => {
    const m = await meta(type);
    expect(m.openGraph?.url).toBe(`${SITE_URL}/booking/${type}`);
    expect(m.alternates?.canonical).toBe(m.openGraph?.url);
  });

  it("uses a 1200x630 JPEG share image for the room", async () => {
    const [image] = ogImages(await meta(type));
    expect(image.url).toMatch(/\.jpg$/);
    expect(image.url).toContain(`booking-${type}`);
    expect(image.width).toBe(1200);
    expect(image.height).toBe(630);
    expect(image.type).toBe("image/jpeg");
    expect(image.alt).toBeTruthy();
  });

  it("titles the card with the room name", async () => {
    const m = await meta(type);
    expect(m.title).toContain(roomTitle);
    expect(m.openGraph?.title).toBe(m.title);
  });

  it("uses a leading slice of the room description, at most 160 chars", async () => {
    const m = await meta(type);
    const description = m.description ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/\.$/);
    expect(description.startsWith("The private room is located")).toBe(true);
  });

  it("gives openGraph and twitter their own title and description", async () => {
    // Metadata merges shallowly, so these replace the layout's objects whole.
    const m = await meta(type);
    expect(m.openGraph?.title).toBeTruthy();
    expect(m.openGraph?.description).toBe(m.description);
    expect(m.twitter?.title).toBe(m.title);
    expect(m.twitter?.description).toBe(m.description);
  });

  it("uses a large twitter card with the same JPEG", async () => {
    const m = await meta(type);
    expect(m.twitter && "card" in m.twitter ? m.twitter.card : undefined).toBe(
      "summary_large_image",
    );
    expect(twitterImages(m)).toContain(ogImages(m)[0].url);
  });

  it("does not fall back to the root layout's home card", async () => {
    const m = await meta(type);
    expect(m.openGraph?.url).not.toBe(SITE_URL);
    for (const url of [...ogImages(m).map((i) => i.url), ...twitterImages(m)]) {
      expect(url).not.toMatch(/\.webp$/);
    }
  });
});

describe("generateMetadata for an unknown type", () => {
  it("resolves to room1's card instead of throwing", async () => {
    await expect(meta("room3")).resolves.toBeDefined();
    const m = await meta("room3");
    expect(m.openGraph?.url).toBe(`${SITE_URL}/booking/room1`);
  });
});
