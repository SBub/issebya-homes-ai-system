import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, format, isMonday } from "date-fns";
import { LOCK_IN_PRICING } from "pricing";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
import { LOCK_IN_FIRST_CHECK_IN, getLockInWeeks } from "@/lib/lock-in";
import { createAdminClient } from "@/lib/shared/supabase";

// The same list the page renders, so the spec follows today like the page.
const weeks = getLockInWeeks(new Date());

const weekLabel = (week: { checkIn: string; checkOut: string }) =>
  `${format(fromCalendarDay(week.checkIn), "d MMM")} – ${format(
    fromCalendarDay(week.checkOut),
    "d MMM",
  )}`;

// getAvailability is "use cache"-tagged, so a seeded or removed row is
// invisible to the page until the tag is expired. The E2E iCal toggle route
// expires room1's tag on every call; `enabled: false` leaves the feeds alone.
const expireRoom1Availability = async (request: import("@playwright/test").APIRequestContext) => {
  const response = await request.post("/api/e2e-ical-mock", { data: { enabled: false } });
  expect(response.ok()).toBe(true);
};

test.describe("Lock-in flow", () => {
  test("/lock-in and an unknown room redirect to /lock-in/room1", async ({ page }) => {
    await page.goto("/lock-in");
    await expect(page).toHaveURL(/\/lock-in\/room1$/);

    await page.goto("/lock-in/nope");
    await expect(page).toHaveURL(/\/lock-in\/room1$/);
  });

  test("the grid shows 12 Monday-to-Monday weeks from 2 Nov 2026 at the earliest", async ({
    page,
  }) => {
    await page.goto("/lock-in/room1");

    await expect(page.locator(".lock-in-week")).toHaveCount(12);

    const first = weeks[0];
    expect(isMonday(fromCalendarDay(first.checkIn))).toBe(true);
    expect(first.checkIn >= LOCK_IN_FIRST_CHECK_IN).toBe(true);
    await expect(page.locator(".lock-in-week").first()).toContainText(weekLabel(first));
  });

  test("a week with one booked night shows as Booked and is not a button", async ({
    page,
    request,
  }) => {
    const supabase = createAdminClient();
    const night = fromCalendarDay(weeks[0].checkIn);

    const { data: guestContact, error: guestContactError } = await supabase
      .from("guest_contacts")
      .insert({
        phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
        email: `e2e-lock-in-${randomUUID()}@example.com`,
        guest_name: "E2E Lock-in Fixture",
        enabled: false,
      })
      .select("id")
      .single();

    if (guestContactError || !guestContact) {
      throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        room_type: "room1",
        check_in: toCalendarDay(addDays(night, 3)),
        check_out: toCalendarDay(addDays(night, 4)),
        nights: 1,
        person_count: 1,
        base_price: 75,
        tourist_tax: 2,
        total_amount: 77,
        guest_contact_id: guestContact.id,
        source: "direct",
        stripe_session_id: `cs_test_e2e_lock_in_${randomUUID()}`,
        status: "confirmed",
      })
      .select("id")
      .single();

    if (bookingError || !booking) {
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      throw new Error(`Failed to seed booking fixture: ${bookingError?.message}`);
    }

    try {
      await expireRoom1Availability(request);
      await page.goto("/lock-in/room1");

      const card = page.locator(".lock-in-week").first();
      await expect(card).toContainText(weekLabel(weeks[0]));
      await expect(card).toContainText("Booked");
      await expect(card).toHaveClass(/lock-in-week-booked/);
      expect(await card.evaluate((el) => el.tagName)).toBe("DIV");
    } finally {
      await supabase.from("bookings").delete().eq("id", booking.id);
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
      await expireRoom1Availability(request);
    }
  });

  test("picking a week goes to Stripe and writes a pending 7-night row with no tourist tax", async ({
    page,
  }) => {
    // Stripe's API is mocked in-process (E2E_MOCK_STRIPE); the redirect to
    // the mocked session URL is fulfilled here.
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Mock Stripe Checkout</body></html>",
      }),
    );

    await page.goto("/lock-in/room1");
    await expect(page.locator(".lock-in-week")).toHaveCount(12);

    // The first week the real local data leaves free.
    let picked: (typeof weeks)[number] | undefined;
    for (const week of weeks) {
      // Only an available week is a <button>; a booked one is a <div>.
      const button = page.locator("button.lock-in-week").filter({ hasText: weekLabel(week) });
      if ((await button.count()) > 0) {
        picked = week;
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        break;
      }
    }
    if (!picked) throw new Error("No free lock-in week in local data");

    await expect(page.getByText(`Total: ${LOCK_IN_PRICING.weekPrice}€`)).toBeVisible();
    await expect(page.getByText(/Tourist tax:/)).toHaveCount(0);

    const email = `e2e-lock-in-${randomUUID()}@example.com`;
    await page.getByLabel(/^name/i).fill("Guest Example");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/whatsapp number/i).fill("920742845");

    await Promise.all([
      page.waitForURL("https://checkout.stripe.com/**"),
      page.getByLabel("Confirm booking").click(),
    ]);

    const supabase = createAdminClient();
    const { data: contact } = await supabase
      .from("guest_contacts")
      .select("id")
      .eq("email", email)
      .single();
    expect(contact).not.toBeNull();

    const { data: rows } = await supabase
      .from("bookings")
      .select("id, check_in, check_out, nights, tourist_tax, total_amount, status, source")
      .eq("guest_contact_id", contact!.id);

    try {
      expect(rows).toHaveLength(1);
      expect(rows![0]).toMatchObject({
        check_in: picked.checkIn,
        check_out: picked.checkOut,
        nights: 7,
        status: "pending",
        source: "direct",
      });
      expect(Number(rows![0].tourist_tax)).toBe(0);
      expect(Number(rows![0].total_amount)).toBe(LOCK_IN_PRICING.weekPrice);
    } finally {
      await supabase.from("bookings").delete().eq("guest_contact_id", contact!.id);
      await supabase.from("guest_contacts").delete().eq("id", contact!.id);
    }
  });

  test("the header marks Lock-in active on lock-in pages only", async ({ page }) => {
    await page.goto("/lock-in/room2");
    await expect(page.getByRole("link", { name: "Lock-in", exact: true })).toHaveClass(
      /border-b-2/,
    );
    await expect(page.getByRole("link", { name: "Booking", exact: true })).not.toHaveClass(
      /border-b-2/,
    );
  });

  test("the nightly booking page still shows the date picker", async ({ page }) => {
    await page.goto("/booking/room1");
    await expect(page.getByLabel("Select check-in date")).toBeVisible();
    await expect(page.locator(".lock-in-week")).toHaveCount(0);
  });
});
