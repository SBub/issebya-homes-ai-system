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

test("the lock-in waitlist is unindexed, chrome-free and carries a JPEG card", async ({
  request,
}) => {
  const res = await request.get("/lockin-waitlist", { headers: { "user-agent": WHATSAPP_UA } });
  expect(res.status()).toBe(200);

  const html = await res.text();
  const headEnd = html.indexOf("</head>");
  const head = html.slice(0, headEnd);
  const body = html.slice(headEnd);

  expect(head).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);

  const og = ogTags(head);
  expect(og.get("og:image")?.endsWith("/og/lockin-waitlist.jpg")).toBe(true);
  expect(og.get("og:image:width")).toBe("1200");
  expect(og.get("og:image:height")).toBe("630");
  expect(og.get("og:image:type")).toBe("image/jpeg");

  // No site header, and the privacy policy is the only place a link leads.
  expect(html).not.toContain("<header");
  const hrefs = [...body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) => href);
  expect(hrefs.length).toBeGreaterThan(0);
  expect(new Set(hrefs)).toEqual(new Set(["/privacy-policy"]));

  // The tag's absolute URL points at production via metadataBase, which
  // lacks the file until merge, so fetch the path from this server.
  const img = await request.get("/og/lockin-waitlist.jpg");
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/jpeg");
  expect((await img.body()).length).toBeLessThan(300_000);
});
