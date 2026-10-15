import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays, startOfDay } from "date-fns";
import { fromCalendarDay, toCalendarDay } from "@/lib/date-utils";
import { createAdminClient } from "@/lib/shared/supabase";

const today = startOfDay(new Date());

// Mirrors formatDate in the confirmation page: the stored calendar day read at
// local midnight, rendered en-GB.
function formatDay(day: string): string {
  return fromCalendarDay(day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type BookingFixture = {
  roomType: "room1" | "room2";
  checkIn: string;
  checkOut: string;
  nights: number;
  personCount: number;
  basePrice: number;
  touristTax: number;
  totalAmount: number;
};

// Days +120 onwards clear every other spec's window: room1 +10..+13
// (booking-flow, blog-booking-flow), room2 +40..+43 (the blog return fixture)
// and the lock-in weeks, which end in late January 2027.
const nightly: BookingFixture = {
  roomType: "room1",
  checkIn: toCalendarDay(addDays(today, 120)),
  checkOut: toCalendarDay(addDays(today, 123)),
  nights: 3,
  personCount: 2,
  basePrice: 300,
  touristTax: 12,
  totalAmount: 312,
};

const lockInWeek: BookingFixture = {
  roomType: "room2",
  checkIn: toCalendarDay(addDays(today, 130)),
  checkOut: toCalendarDay(addDays(today, 137)),
  nights: 7,
  personCount: 1,
  basePrice: 700,
  touristTax: 0,
  totalAmount: 700,
};

// The fixture is a *confirmed* booking on purpose: /api/bookings/direct only
// calls stripe.checkout.sessions.retrieve for a `pending` or missing row, and
// E2E_MOCK_STRIPE does not mock that call. A confirmed row is served straight
// from the database, so this spec never reaches Stripe.
async function seedConfirmedBooking(fixture: BookingFixture) {
  const supabase = createAdminClient();
  const email = `e2e-confirmation-${randomUUID()}@example.com`;

  const { data: guestContact, error: guestContactError } = await supabase
    .from("guest_contacts")
    .insert({
      // Both `phone` and `email` are independently UNIQUE on guest_contacts,
      // so both are randomised per run.
      phone: `+000${randomUUID().replace(/\D/g, "").slice(0, 10)}`,
      email,
      guest_name: "E2E Confirmation Fixture",
      enabled: false,
    })
    .select("id")
    .single();

  if (guestContactError || !guestContact) {
    throw new Error(`Failed to seed guest_contacts fixture: ${guestContactError?.message}`);
  }

  const sessionId = `cs_test_e2e_confirmation_${randomUUID()}`;
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      room_type: fixture.roomType,
      check_in: fixture.checkIn,
      check_out: fixture.checkOut,
      nights: fixture.nights,
      person_count: fixture.personCount,
      base_price: fixture.basePrice,
      tourist_tax: fixture.touristTax,
      total_amount: fixture.totalAmount,
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
    email,
    cleanup: async () => {
      await supabase.from("bookings").delete().eq("id", booking.id);
      await supabase.from("guest_contacts").delete().eq("id", guestContact.id);
    },
  };
}

// The details are a plain <label> + <p> pair with no form control, so
// getByLabel cannot resolve them: scope to the label's parent instead.
function fieldValue(page: Page, label: string) {
  return page.locator(`label:text-is("${label}")`).locator("..").locator("p");
}

// A price row is a <div> holding a label <span> and an amount <span>.
function priceRow(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..");
}

function confirmationUrl(sessionId: string) {
  return `/booking/confirmation?session=${encodeURIComponent(sessionId)}`;
}

test.describe("Booking confirmation page", () => {
  test("a nightly room1 booking shows its details, tourist tax and email", async ({ page }) => {
    const { sessionId, email, cleanup } = await seedConfirmedBooking(nightly);

    try {
      await page.goto(confirmationUrl(sessionId));

      await expect(
        page.getByRole("heading", { level: 1, name: "Booking Confirmed" }),
      ).toBeVisible();
      await expect(page.getByText("Thank you for your reservation")).toBeVisible();

      await expect(fieldValue(page, "Room")).toHaveText("Room 1");
      await expect(fieldValue(page, "Check-in")).toHaveText(formatDay(nightly.checkIn));
      await expect(fieldValue(page, "Check-out")).toHaveText(formatDay(nightly.checkOut));
      await expect(fieldValue(page, "Nights")).toHaveText("3");
      await expect(fieldValue(page, "Guests")).toHaveText("2 Guests");

      await expect(priceRow(page, "Room price")).toContainText("€300");
      await expect(priceRow(page, "Tourist tax")).toContainText("€12");
      await expect(priceRow(page, "Total")).toContainText("€312");

      // The email comes from the guest_contacts join, flattened by the route.
      await expect(page.getByText(/A confirmation email has been sent to/)).toContainText(email);

      await expect(page.getByRole("img", { name: "Room 1" })).toBeVisible();
      await expect(page.getByTestId("return-to-post")).toHaveCount(0);
    } finally {
      await cleanup();
    }
  });

  test("a room2 lock-in week shows one guest and no tourist tax row", async ({ page }) => {
    const { sessionId, cleanup } = await seedConfirmedBooking(lockInWeek);

    try {
      await page.goto(confirmationUrl(sessionId));

      await expect(
        page.getByRole("heading", { level: 1, name: "Booking Confirmed" }),
      ).toBeVisible();

      await expect(fieldValue(page, "Room")).toHaveText("Room 2");
      await expect(fieldValue(page, "Check-in")).toHaveText(formatDay(lockInWeek.checkIn));
      await expect(fieldValue(page, "Check-out")).toHaveText(formatDay(lockInWeek.checkOut));
      await expect(fieldValue(page, "Nights")).toHaveText("7");
      // Exact text, so a "1 Guests" plural regression fails.
      await expect(fieldValue(page, "Guests")).toHaveText("1 Guest");

      // Room price and Total are both €700: scope each to its own row.
      await expect(priceRow(page, "Room price")).toContainText("€700");
      await expect(priceRow(page, "Total")).toContainText("€700");
      // Checked after the heading is visible, so the page has rendered.
      await expect(page.getByText("Tourist tax")).toHaveCount(0);
    } finally {
      await cleanup();
    }
  });

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("the details render and the room photo is hidden", async ({ page }) => {
      const { sessionId, cleanup } = await seedConfirmedBooking(nightly);

      try {
        await page.goto(confirmationUrl(sessionId));

        await expect(
          page.getByRole("heading", { level: 1, name: "Booking Confirmed" }),
        ).toBeVisible();
        await expect(fieldValue(page, "Room")).toHaveText("Room 1");
        await expect(fieldValue(page, "Nights")).toHaveText("3");
        await expect(fieldValue(page, "Guests")).toHaveText("2 Guests");
        await expect(priceRow(page, "Total")).toContainText("€312");

        // The photo column is `hidden md:flex`: display none below md.
        await expect(page.getByRole("img", { name: "Room 1" })).toBeHidden();
      } finally {
        await cleanup();
      }
    });
  });

  test.describe("without a session", () => {
    // No status assertion: the page streams behind loading.tsx, so the
    // response can be committed as 200 before notFound() runs. The rendered
    // not-found text is the stable signal.
    for (const url of ["/booking/confirmation", "/booking/confirmation?session="]) {
      test(`${url} renders not found`, async ({ page }) => {
        await page.goto(url);

        await expect(page.getByText("This page could not be found.")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toHaveCount(0);
      });
    }
  });
});
