import { expect, test } from "@playwright/test";
import { SITE_URL, WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site";

// The site's entry and static pages. No database, no fixtures. External links
// are asserted by attribute and never followed.

// What WhatsApp's link-preview fetcher sends. It is in Next's HTML-limited bot
// list, so metadata must be rendered into <head> rather than streamed.
const WHATSAPP_UA = "WhatsApp/2.23.20.0 A";

// The class a header or section nav link carries while it is the active one.
const ACTIVE = /\bborder-b-2\b/;

const headOf = (html: string) => {
  const headEnd = html.indexOf("</head>");
  expect(headEnd).toBeGreaterThan(0);
  return html.slice(0, headEnd);
};

const NAV = [
  { name: "Lock-in", url: "/lock-in/room1" },
  { name: "Blog", url: "/blog" },
  { name: "Shop", url: "/shop" },
  { name: "Contact", url: "/contact" },
] as const;

const FOOTER_PAGES = [
  { name: "Terms & Conditions", url: "/terms-and-conditions" },
  { name: "Privacy Policy", url: "/privacy-policy" },
] as const;

const GUEST_INFO_SECTIONS = [
  "Arrival Information",
  "Parking",
  "House Guidelines",
  "Waste & Recycling",
  "Local Essentials",
  "Beaches & Hikes",
  "Need Anything?",
];

const NOINDEX_PATHS = ["/privacy-policy", "/terms-and-conditions", "/guest-info"];

test.describe("Site smoke", () => {
  test("/ and /booking redirect to /booking/room1", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");

    await page.goto("/booking");
    await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");
  });

  test.describe("header", () => {
    test("Booking is the active header link on /booking/room1", async ({ page }) => {
      await page.goto("/booking/room1");
      const header = page.locator("header");

      await expect(header.getByRole("link", { name: "Booking", exact: true })).toHaveClass(ACTIVE);
      for (const { name } of NAV) {
        await expect(header.getByRole("link", { name, exact: true })).not.toHaveClass(ACTIVE);
      }
    });

    for (const { name, url } of NAV) {
      test(`${name} reaches ${url} and becomes the active link`, async ({ page }) => {
        await page.goto("/booking/room1");
        const header = page.locator("header");

        await header.getByRole("link", { name, exact: true }).click();

        await expect(page).toHaveURL((u) => u.pathname === url);
        await expect(header.getByRole("link", { name, exact: true })).toHaveClass(ACTIVE);
        await expect(header.getByRole("link", { name: "Booking", exact: true })).not.toHaveClass(
          ACTIVE,
        );
      });
    }

    test("the logo returns to /booking/room1", async ({ page }) => {
      await page.goto("/contact");

      await page.locator("header").getByRole("link", { name: "issebya.homes" }).click();

      await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");
    });
  });

  test.describe("footer", () => {
    for (const { name, url } of FOOTER_PAGES) {
      test(`${name} reaches ${url}`, async ({ page }) => {
        await page.goto("/contact");

        await page.locator("footer").getByRole("link", { name, exact: true }).click();

        await expect(page).toHaveURL((u) => u.pathname === url);
        await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      });
    }

    test("the Instagram link opens the profile in a new tab", async ({ page }) => {
      await page.goto("/contact");
      const instagram = page.locator("footer").getByRole("link", { name: "Instagram" });

      await expect(instagram).toHaveAttribute("href", "https://www.instagram.com/issebya.homes");
      await expect(instagram).toHaveAttribute("target", "_blank");
      await expect(instagram).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  test("/contact shows the custom bookings copy and the WhatsApp link", async ({ page }) => {
    await page.goto("/contact");

    await expect(page.getByText(/^For custom bookings, special requests/)).toBeVisible();

    const whatsapp = page.locator("main").getByRole("link", { name: /WhatsApp/ });
    await expect(whatsapp).toHaveCount(1);
    await expect(whatsapp).toHaveAttribute("href", WHATSAPP_URL);
    await expect(whatsapp).toContainText(WHATSAPP_DISPLAY_NUMBER);
    await expect(whatsapp).toHaveAttribute("target", "_blank");
    await expect(whatsapp).toHaveAttribute("rel", /\bnoopener\b/);
  });

  test("/guest-info section nav marks and scrolls to the chosen section", async ({ page }) => {
    // Mobile layout, so the page is long relative to the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/guest-info");

    await expect(page.getByRole("heading", { level: 1, name: "Guest Info" })).toBeVisible();

    const sectionLinks = page.locator('nav a[href^="#"]');
    await expect(sectionLinks).toHaveCount(GUEST_INFO_SECTIONS.length);
    await expect(sectionLinks).toHaveText(GUEST_INFO_SECTIONS);

    // A section near the bottom, so it starts fully below the fold. The early
    // ones (Parking) already peek into an 844px viewport on load.
    const beaches = page.locator("#beaches-hikes");
    await expect(beaches).not.toBeInViewport();

    const beachesLink = page.getByRole("link", { name: "Beaches & Hikes", exact: true });
    await beachesLink.click();

    await expect(page).toHaveURL(/#beaches-hikes$/);
    await expect(beachesLink).toHaveClass(ACTIVE);
    // The scroll is smooth, so this must poll rather than read once.
    await expect(beaches).toBeInViewport();
  });

  test.describe("noindex", () => {
    for (const path of NOINDEX_PATHS) {
      test(`${path} is noindex, nofollow`, async ({ request }) => {
        const res = await request.get(path, { headers: { "user-agent": WHATSAPP_UA } });
        expect(res.status()).toBe(200);

        expect(headOf(await res.text())).toMatch(
          /<meta name="robots" content="noindex, nofollow"\s*\/?>/,
        );
      });
    }

    test("/contact is indexable", async ({ request }) => {
      const res = await request.get("/contact", { headers: { "user-agent": WHATSAPP_UA } });
      expect(res.status()).toBe(200);

      const head = headOf(await res.text());
      expect(head).toContain("<title>");
      expect(head).not.toMatch(/<meta name="robots"[^>]*noindex/);
    });
  });

  test("/robots.txt and /sitemap.xml list the expected routes", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsTxt = await robots.text();
    expect(robotsTxt).toMatch(/^Disallow: \/api\/$/m);
    expect(robotsTxt).toMatch(/^Disallow: \/guest-info$/m);
    expect(robotsTxt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapXml = await sitemap.text();
    for (const path of ["/contact", "/terms-and-conditions", "/privacy-policy"]) {
      expect(sitemapXml).toContain(`<loc>${SITE_URL}${path}</loc>`);
    }
    expect(sitemapXml).not.toContain("/guest-info");
  });
});
