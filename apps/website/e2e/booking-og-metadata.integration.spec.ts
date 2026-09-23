import { expect, test } from "@playwright/test";

// What WhatsApp's link-preview fetcher sends. It is in Next's HTML-limited bot
// list, so metadata must be rendered into <head> rather than streamed.
const WHATSAPP_UA = "WhatsApp/2.23.20.0 A";

// Every <meta property="og:..." content="..."> tag in `html`, by property.
const ogTags = (html: string) =>
  new Map(
    [...html.matchAll(/<meta property="(og:[^"]+)" content="([^"]*)"/g)].map(
      ([, property, content]) => [property, content],
    ),
  );

for (const [type, roomTitle] of [
  ["room1", "Private room 1"],
  ["room2", "Private room 2"],
] as const) {
  test(`${type} booking link serves a room-specific card to WhatsApp`, async ({ request }) => {
    const res = await request.get(
      `/booking/${type}?checkIn=2026-10-06&checkOut=2026-10-08&source=gca`,
      { headers: { "user-agent": WHATSAPP_UA } },
    );
    expect(res.ok()).toBe(true);

    // Only <head> counts: a non-JS fetcher never sees tags streamed into <body>.
    const html = await res.text();
    const og = ogTags(html.slice(0, html.indexOf("</head>")));

    expect(og.get("og:title")).toContain(roomTitle);
    expect(og.get("og:url")?.endsWith(`/booking/${type}`)).toBe(true);
    expect(og.get("og:image")?.endsWith(`/og/booking-${type}.jpg`)).toBe(true);
    expect(og.get("og:image:width")).toBe("1200");
    expect(og.get("og:image:height")).toBe("630");
    expect(og.get("og:image:type")).toBe("image/jpeg");

    // The tag's absolute URL points at production via metadataBase, which
    // lacks the file until merge, so fetch the path from this server.
    const img = await request.get(`/og/booking-${type}.jpg`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toBe("image/jpeg");
    expect((await img.body()).length).toBeLessThan(300_000);
  });
}
