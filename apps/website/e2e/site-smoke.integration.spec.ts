import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, startOfDay } from "date-fns";
import { toCalendarDay } from "@/lib/date-utils";
import { ROOM_CONTENT } from "@/lib/shared/room-content";
import { createAdminClient } from "@/lib/shared/supabase";
import { sortProducts } from "@/lib/shop/pagination";
import { allProducts } from "@/lib/shop/products";
import { SITE_URL, WHATSAPP_DISPLAY_NUMBER, WHATSAPP_URL } from "@/lib/site";
import {
  confirmAndReachStripe,
  deleteGuestBookings,
  fillGuestDetails,
  mockStripeCheckout,
  saveToWishlist,
  selectCalendarRange,
  uniqueGuest,
} from "./support/journeys";

// The site's entry and static pages, then its key journeys. The page tests
// touch no database. External links are asserted by attribute and never
// followed. The `key journeys` group writes rows under a fresh random email
// per test and deletes them in `finally`; Stripe (E2E_MOCK_STRIPE) and Resend
// (E2E_MOCK_RESEND) are mocked in-process, so nothing leaves the machine.

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

const ROOMS = ["room1", "room2"] as const;

// Booking windows clear of every other spec. The suite runs `workers: 1` (see
// the note in blog-booking-flow.integration.spec.ts): booking-flow books and
// seeds room1 +10..+13 and prefills room1 +300..+302; blog-booking-flow books
// room1 +10..+13 and seeds a confirmed room2 +40..+43.
// +320 and beyond is past anything the OTA feeds publish, and the
// ?checkIn=&checkOut= prefill reaches it without month navigation.
const today = startOfDay(new Date());
const NIGHTLY = {
  room1: [addDays(today, 320), addDays(today, 322)],
  room2: [addDays(today, 324), addDays(today, 326)],
} as const;
// Inside the month the widget's calendar opens on; no spec touches room2 there.
const WIDGET_STAY = [addDays(today, 6), addDays(today, 8)] as const;

const WIDGET_POST = "/blog/welcome-to-issebya-homes";
const WIDGET_POST_TITLE = "A house for rest between the Sintra forest and the Atlantic";

test.describe("Site smoke", () => {
  test("/ and /booking redirect to /booking/room1", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");

    await page.goto("/booking");
    await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");
  });

  test.describe("header", () => {
    for (const path of ["/booking/room1", "/booking/room2"]) {
      test(`Booking is the active header link on ${path}`, async ({ page }) => {
        await page.goto(path);
        const header = page.locator("header");

        await expect(header.getByRole("link", { name: "Booking", exact: true })).toHaveClass(
          ACTIVE,
        );
        for (const { name } of NAV) {
          await expect(header.getByRole("link", { name, exact: true })).not.toHaveClass(ACTIVE);
        }
      });
    }

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

  test("/booking/room2 renders the room and its booking engine", async ({ page }) => {
    await page.goto("/booking/room2");

    await expect(page).toHaveURL((url) => url.pathname === "/booking/room2");
    await expect(page.getByText(ROOM_CONTENT.room2.description[0])).toBeVisible();
    await expect(page.getByLabel("Select check-in date")).toBeVisible();
    await expect(page.getByLabel("Select check-out date")).toBeVisible();
    await expect(page.getByLabel("Book selected dates")).toBeVisible();
  });

  test("the Room 2 tab reaches /booking/room2 and Booking stays active", async ({ page }) => {
    // The default 1280px viewport shows the desktop tabs; the mobile ones are
    // display: none there, so each name resolves to a single link.
    await page.goto("/booking/room1");
    const header = page.locator("header");

    await page.getByRole("link", { name: "Room 2", exact: true }).click();

    await expect(page).toHaveURL((url) => url.pathname === "/booking/room2");
    await expect(header.getByRole("link", { name: "Booking", exact: true })).toHaveClass(ACTIVE);
    await expect(page.getByText(ROOM_CONTENT.room2.description[0])).toBeVisible();

    await page.getByRole("link", { name: "Room 1", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/booking/room1");
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

      await expect(instagram).toHaveAttribute("href", "https://www.instagram.com/home.issebya");
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

  // One happy path per journey, end to end. Edge cases stay in the dedicated
  // specs these helpers come from.
  test.describe("key journeys", () => {
    for (const room of ROOMS) {
      test(`nightly booking in ${room} reaches Stripe`, async ({ page }) => {
        const guest = uniqueGuest("e2e-smoke-");
        const [checkIn, checkOut] = NIGHTLY[room];
        try {
          await mockStripeCheckout(page);
          await page.goto(
            `/booking/${room}?${new URLSearchParams({
              checkIn: toCalendarDay(checkIn),
              checkOut: toCalendarDay(checkOut),
            })}`,
          );

          await page.getByLabel("Book selected dates").click();
          await expect(page.getByLabel("Confirm booking")).toBeVisible();
          await fillGuestDetails(page, guest);
          await confirmAndReachStripe(page);
        } finally {
          await deleteGuestBookings(guest.email);
        }
      });
    }

    test("saving a shop item to the wishlist shows the saved state", async ({ page }) => {
      const email = `e2e-smoke-wishlist-${randomUUID()}@example.com`;
      try {
        await saveToWishlist(page, sortProducts(allProducts, "newest")[0].slug, email);
      } finally {
        // Its items cascade.
        await createAdminClient().from("shop_wishlist_contacts").delete().eq("email", email);
      }
    });

    test("booking a room from a blog post's widget reaches Stripe", async ({ page }) => {
      const guest = uniqueGuest("e2e-smoke-");
      try {
        await mockStripeCheckout(page);
        await page.goto("/blog");
        await page.getByRole("link", { name: WIDGET_POST_TITLE }).click();
        await expect(page).toHaveURL(WIDGET_POST);
        await expect(page.locator("article").getByTestId("booking-widget")).toBeVisible();

        await page.getByRole("tab", { name: "room 2" }).click();
        await page.getByLabel("Book selected dates").click();
        await expect(page.getByLabel("Confirm booking")).toBeVisible();
        await selectCalendarRange(page, ...WIDGET_STAY);
        await fillGuestDetails(page, guest);
        await confirmAndReachStripe(page);
      } finally {
        await deleteGuestBookings(guest.email);
      }
    });
  });
});
