import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, format, startOfDay } from "date-fns";
import { createAdminClient } from "@/lib/shared/supabase";

// Generate future dates relative to today so tests don't go stale
const today = startOfDay(new Date());
const checkInLabel = format(addDays(today, 10), "MMMM d, yyyy");
const checkOutLabel = format(addDays(today, 13), "MMMM d, yyyy");
// The same day as checkInLabel, in the format the collapsed engine displays it.
const checkInDisplayText = format(addDays(today, 10), "d MMM yyyy");

const WIDGET_POST = "/blog/welcome-to-issebya-homes";
const POST_TITLE =
  "Welcome to issebya.homes: a house for rest between the Sintra forest and the Atlantic";

test.describe("Blog with an inline booking widget", () => {
  test("index lists the post and links to it", async ({ page }) => {
    await page.goto("/blog");

    // Newest-first ordering is covered one layer down, in
    // src/lib/blog/__tests__/schema.unit.test.ts, so with a single post the
    // index only has to render it and route to it.
    await page.getByRole("heading", { name: POST_TITLE }).click();
    await expect(page).toHaveURL(WIDGET_POST);
    await expect(page.getByRole("heading", { level: 1, name: POST_TITLE })).toBeVisible();
  });

  test("booking completes from inside a post", async ({ page }) => {
    // Same mocking story as e2e/booking-flow.integration.spec.ts: the
    // server-side Stripe call is intercepted in-process by MSW (gated on
    // E2E_MOCK_STRIPE, set by playwright.config.ts), and the browser-level
    // navigation to the returned checkout URL is fulfilled here so the test
    // never reaches real Stripe.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Mock Stripe Checkout</body></html>",
      }),
    );

    await page.goto(WIDGET_POST);

    // The widget renders inside the article, not as a link out to /booking.
    const widget = page.getByTestId("booking-widget");
    await expect(widget).toBeVisible();
    await expect(page.locator("article").getByTestId("booking-widget")).toBeVisible();

    await page.getByLabel("Book selected dates").click();
    await expect(page.getByLabel("Confirm booking")).toBeVisible();

    await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
    await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();

    await page.getByLabel(/^name/i).fill("Guest Example");
    await page.getByLabel(/email/i).fill("guest@example.com");
    await page.getByLabel(/whatsapp number/i).fill("920742845");

    await expect(page.getByLabel("Confirm booking")).toBeEnabled();

    // Same destination a booking from /booking/[type] reaches, which is the
    // point of this test: the widget is the same engine, action and checkout.
    await Promise.all([
      page.waitForURL("https://checkout.stripe.com/**"),
      page.getByLabel("Confirm booking").click(),
    ]);
  });

  test("switching rooms issues no request", async ({ page }) => {
    await page.goto(WIDGET_POST);
    await expect(page.getByLabel("Book selected dates")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Both rooms' engines are props on the client switcher, so both are
    // already in the static payload. This is the observable form of that: no
    // availability fetch and no RSC round trip on a room switch.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await page.getByRole("tab", { name: "room 2" }).click();
    await expect(page.getByRole("tab", { name: "room 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    expect(requests.filter((url) => url.includes("/api/availability"))).toEqual([]);
    expect(requests.filter((url) => url.includes("_rsc="))).toEqual([]);
  });

  // This spec asserts the remount rather than the two rooms' blocked days
  // differing, on purpose. getAvailability is a `"use cache"` function with
  // cacheLife("minutes"), prewarmed at dev-server boot, so making the rooms'
  // availability genuinely differ end to end would mean seeding the shared
  // local database and adding an E2E-only cache-busting route. The blocked-date
  // property is proved deterministically one layer down, in
  // src/app/(main)/blog/ui/RoomSwitcher.browser.test.tsx, against the real
  // calendar with per-room fixtures.
  test("switching rooms resets the engine instead of carrying room 1's state over", async ({
    page,
  }) => {
    await page.goto(WIDGET_POST);

    await page.getByLabel("Book selected dates").click();
    await expect(page.getByLabel("Confirm booking")).toBeVisible();

    await page.locator(`button:not([disabled])[aria-label="${checkInLabel}"]`).click();
    await page.locator(`button:not([disabled])[aria-label="${checkOutLabel}"]`).click();

    const checkInDisplay = page.getByLabel("Select check-in date");
    await expect(checkInDisplay).toHaveText(checkInDisplayText);

    await page.getByRole("tab", { name: "room 2" }).click();

    // Room 2's engine mounted fresh: collapsed, with room 2's own server
    // defaults, and none of the selection made on room 1.
    await expect(page.getByLabel("Confirm booking")).not.toBeVisible();
    await expect(checkInDisplay).not.toHaveText(checkInDisplayText);
  });
});

test.describe("Blog breadcrumb trail", () => {
  test("a post links back to the index through a breadcrumb trail", async ({ page }) => {
    await page.goto(WIDGET_POST);

    const trail = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(trail).toBeVisible();

    await expect(trail.getByRole("link", { name: "blog" })).toHaveAttribute("href", "/blog");

    // The post's own title is the second and last item: marked aria-current,
    // and deliberately not a link.
    const current = trail.getByRole("listitem").nth(1);
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(current).toContainText(POST_TITLE);
    await expect(trail.getByRole("link", { name: POST_TITLE })).toHaveCount(0);

    await trail.getByRole("link", { name: "blog" }).click();
    await page.waitForURL("**/blog");

    await expect(page.getByRole("heading", { name: POST_TITLE })).toBeVisible();
  });

  // The index is the root of the trail, so it shows none. This also proves the
  // selector above is specific enough: the site header is a <nav> too, but an
  // unnamed one, so filtering on the accessible name keeps this at zero.
  test("the index shows no breadcrumb", async ({ page }) => {
    await page.goto("/blog");

    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  });
});

test.describe("Booking confirmation returns to the originating post", () => {
  // The fixture is a *confirmed* booking on purpose: /api/bookings/direct
  // only calls Stripe for a `pending` row, so a confirmed one is served
  // straight from the database and this spec needs no new MSW handler.
  //
  // room2 on days +40..+43 is also deliberate. The suite runs `workers: 1`
  // (see playwright.config.ts for the two collisions that forced that), and
  // the widget booking test above books room1 on +10..+13 — seeding well
  // clear of that window keeps this fixture from blocking anyone's calendar.
  const seedCheckIn = format(addDays(today, 40), "yyyy-MM-dd");
  const seedCheckOut = format(addDays(today, 43), "yyyy-MM-dd");

  async function seedConfirmedBooking() {
    const supabase = createAdminClient();

    const { data: guestContact, error: guestContactError } = await supabase
      .from("guest_contacts")
      .insert({
        // Both `phone` and `email` are independently UNIQUE on
        // guest_contacts, so both are randomised per run.
        phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
        email: `e2e-return-${randomUUID()}@example.com`,
        guest_name: "E2E Return Fixture",
        enabled: false,
      })
      .select("id")
      .single();

    if (guestContactError || !guestContact) {
      throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
    }

    const sessionId = `cs_test_e2e_return_${randomUUID()}`;
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        room_type: "room2",
        check_in: seedCheckIn,
        check_out: seedCheckOut,
        nights: 3,
        person_count: 1,
        base_price: 100,
        tourist_tax: 10,
        total_amount: 110,
        guest_contact_id: guestContact.id,
        source: "direct",
        stripe_session_id: sessionId,
        status: "confirmed",
      })
      .select("id")
      .single();

    if (bookingError || !booking) {
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      throw new Error(`Failed to seed confirmed booking fixture: ${bookingError?.message}`);
    }

    return {
      sessionId,
      cleanup: async () => {
        await supabase.from("bookings").delete().eq("id", booking.id);
        await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      },
    };
  }

  test("a valid return target renders a link that lands on the post's widget", async ({ page }) => {
    const { sessionId, cleanup } = await seedConfirmedBooking();

    try {
      await page.goto(
        `/booking/confirmation?session=${encodeURIComponent(sessionId)}&return=${encodeURIComponent(WIDGET_POST)}`,
      );

      await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toBeVisible();

      const returnLink = page.getByTestId("return-to-post");
      await expect(returnLink).toBeVisible();
      // The title comes from the post registry, not from the URL, which is
      // what proves the page resolved the slug rather than echoing it.
      await expect(returnLink).toContainText(POST_TITLE);
      await expect(returnLink).toHaveAttribute("href", `${WIDGET_POST}#book`);

      await returnLink.click();
      await page.waitForURL(`**${WIDGET_POST}#book`);

      // The anchor target really exists on the post, so the reader lands at
      // the widget rather than at the top of the article.
      await expect(page.getByTestId("booking-widget")).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  // Anyone can type this query parameter by hand, so the page revalidates it
  // from scratch. A rejected target costs the link and nothing else: no
  // redirect, no error, the same confirmation page as always.
  test.describe("a forged return target is dropped", () => {
    for (const [label, forged] of [
      ["an absolute URL", "https://evil.example/"],
      ["a protocol-relative URL", "//evil.example"],
      ["a slug that names no post", "/blog/does-not-exist"],
      ["a non-blog internal path", "/booking/room1"],
    ] as const) {
      test(label, async ({ page }) => {
        const { sessionId, cleanup } = await seedConfirmedBooking();

        try {
          await page.goto(
            `/booking/confirmation?session=${encodeURIComponent(sessionId)}&return=${encodeURIComponent(forged)}`,
          );

          await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toBeVisible();
          await expect(page.getByTestId("return-to-post")).toHaveCount(0);
        } finally {
          await cleanup();
        }
      });
    }
  });
});
